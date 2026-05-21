import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildTeamRoutes } from "./team";

const session: AuthSession = {
  session: { id: "sess_1", userId: "owner_1" },
  user: { email: "owner@example.com", id: "owner_1", name: "Owner" },
};

const buildAppWithGuard = (vars: StaffContextVars, routes: ReturnType<typeof buildTeamRoutes>) => {
  const app = new Hono<{ Variables: StaffContextVars }>();
  app.use("*", async (c, next) => {
    c.set("session", vars.session);
    c.set("orgId", vars.orgId);
    c.set("role", vars.role);
    await next();
  });
  app.route("/", routes);
  return app;
};

const buildPrismaMock = () => ({
  activityLog: { create: vi.fn().mockResolvedValue({}) },
  orgMembership: {
    findMany: vi.fn().mockResolvedValue([
      {
        createdAt: new Date("2026-01-01"),
        id: "mem_1",
        orgId: "org_a",
        role: "OWNER",
        user: {
          displayName: null,
          email: "owner@example.com",
          id: "owner_1",
          image: null,
          name: "Owner",
        },
        userId: "owner_1",
      },
    ]),
    upsert: vi.fn().mockResolvedValue({ id: "mem_new" }),
  },
  user: {
    create: vi.fn(({ data }: { data: { email: string; name: string } }) =>
      Promise.resolve({
        email: data.email,
        emailVerified: false,
        id: "user_new",
        name: data.name,
      }),
    ),
    findUnique: vi.fn().mockResolvedValue(null),
  },
});

describe("GET /team/members", () => {
  it("returns the org's memberships with user joined", async () => {
    const prisma = buildPrismaMock();
    const routes = buildTeamRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/members"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{ id: string; role: string; user: { email: string } }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.user.email).toBe("owner@example.com");
    expect(prisma.orgMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org_a" } }),
    );
  });
});

describe("POST /team/invite", () => {
  it("creates a new User + OrgMembership for a CUSTOMER and triggers magic-link", async () => {
    const prisma = buildPrismaMock();
    const auth = { api: { signInMagicLink: vi.fn().mockResolvedValue({}) } };
    const logActivity = vi.fn().mockResolvedValue(undefined);

    const routes = buildTeamRoutes({ auth, logActivity, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/invite", {
        body: JSON.stringify({ email: "c@example.com", name: "Cliente", role: "CUSTOMER" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { email: string; role: string } };
    expect(body.member.email).toBe("c@example.com");
    expect(body.member.role).toBe("CUSTOMER");

    expect(prisma.user.create).toHaveBeenCalledOnce();
    expect(prisma.orgMembership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { orgId: "org_a", role: "CUSTOMER", userId: "user_new" },
      }),
    );
    expect(auth.api.signInMagicLink).toHaveBeenCalledOnce();
    expect(auth.api.signInMagicLink.mock.calls[0]![0]).toMatchObject({
      body: { email: "c@example.com" },
    });
    expect(logActivity).toHaveBeenCalledOnce();
    expect(logActivity.mock.calls[0]![0]).toMatchObject({
      orgId: "org_a",
      refType: "ORGANIZATION",
      type: "MEMBER_INVITED",
    });
  });

  it("reuses an existing User on CUSTOMER invite (no duplicate creation)", async () => {
    const prisma = buildPrismaMock();
    prisma.user.findUnique.mockResolvedValueOnce({
      email: "existing@example.com",
      emailVerified: true,
      id: "user_existing",
      name: "Existing",
    });
    const auth = { api: { signInMagicLink: vi.fn().mockResolvedValue({}) } };

    const routes = buildTeamRoutes({ auth, prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/invite", {
        body: JSON.stringify({ email: "existing@example.com", name: "Existing", role: "CUSTOMER" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.orgMembership.upsert).toHaveBeenCalled();
  });

  it("sends a welcome email for STAFF invite when Resend is configured", async () => {
    const prisma = buildPrismaMock();
    const auth = { api: { signInMagicLink: vi.fn() } };
    const sendWelcome = vi.fn().mockResolvedValue({ success: true });

    const routes = buildTeamRoutes({
      auth,
      prisma: prisma as never,
      resendApiKey: "test-key",
      sendWelcome,
    });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/invite", {
        body: JSON.stringify({ email: "staff@example.com", name: "Staff", role: "STAFF" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
    expect(auth.api.signInMagicLink).not.toHaveBeenCalled();
    expect(sendWelcome).toHaveBeenCalledOnce();
    expect(sendWelcome.mock.calls[0]![0]).toMatchObject({ userEmail: "staff@example.com" });
  });

  it("rejects STAFF callers (only OWNER can invite)", async () => {
    const prisma = buildPrismaMock();
    const routes = buildTeamRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/invite", {
        body: JSON.stringify({ email: "c@example.com", name: "Cliente", role: "CUSTOMER" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("422s when the body fails validation", async () => {
    const prisma = buildPrismaMock();
    const routes = buildTeamRoutes({ prisma: prisma as never });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/invite", {
        body: JSON.stringify({ email: "not-an-email", name: "", role: "BOGUS" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(422);
  });
});
