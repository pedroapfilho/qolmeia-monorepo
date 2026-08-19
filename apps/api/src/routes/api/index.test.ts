import { Prisma } from "@repo/db";
import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import { describe, expect, it, vi } from "vitest";

import { requireMemberForDiscovery, type AuthSession } from "@/middleware/require-staff";

import { buildMeRoutes } from "./me";
import { buildOrgsRoutes } from "./orgs";

import { buildApiRoutes } from "./index";

const sessionA: AuthSession = {
  session: { id: "sess_a", userId: "user_a" },
  user: { email: "a@example.com", id: "user_a", name: "A" },
};

const buildAllowGuard = (): MiddlewareHandler => (c: Context, next: Next) => {
  c.set("session", sessionA);
  c.set("orgId", "org_a");
  c.set("role", "OWNER");
  return next();
};

const buildRejectGuard = (): MiddlewareHandler => (c: Context, _next: Next) =>
  Promise.resolve(c.json({ error: { code: "UNAUTHORIZED", message: "No session" } }, 401));

const buildMockPrisma = () => {
  const prisma = {
    $transaction: vi.fn(
      <Result>(callback: (tx: typeof prisma) => Promise<Result>): Promise<Result> =>
        callback(prisma),
    ),
    organization: {
      create: vi.fn().mockResolvedValue({ id: "new_org", name: "New", slug: "new-org" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orgMembership: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([
        {
          createdAt: new Date("2026-01-01"),
          org: { id: "org_a", name: "Org A", slug: "org-a" },
          orgId: "org_a",
          role: "OWNER",
          userId: "user_a",
        },
      ]),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        displayName: null,
        email: "a@example.com",
        emailVerified: true,
        id: "user_a",
        image: null,
        name: "A",
        username: null,
      }),
    },
  };
  return prisma;
};

const buildV1WithMocks = (
  guard: MiddlewareHandler,
  prisma: ReturnType<typeof buildMockPrisma>,
): Hono => {
  const provision = vi.fn().mockResolvedValue({ ok: true as const });

  return buildApiRoutes({
    memberGuard: guard,
    routes: {
      me: buildMeRoutes({ prisma: prisma as never }),
      orgs: buildOrgsRoutes({
        auth: { api: { getSession: () => Promise.resolve(sessionA) } },
        prisma: prisma as never,
        provision,
      }),
    },
  });
};

describe("/api post-P7.2 surface", () => {
  it("returns 401 from /me when guard rejects", async () => {
    const app = buildV1WithMocks(buildRejectGuard(), buildMockPrisma());
    const res = await app.fetch(new Request("http://localhost/me"));
    expect(res.status).toBe(401);
  });

  it("returns the current user + currentOrg via /me", async () => {
    const app = buildV1WithMocks(buildAllowGuard(), buildMockPrisma());
    const res = await app.fetch(new Request("http://localhost/me"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { currentOrg: { id: string }; user: { email: string } };
    expect(body.currentOrg.id).toBe("org_a");
    expect(body.user.email).toBe("a@example.com");
  });

  it("answers /me for a multi-org user that sent no X-Org-Id", async () => {
    const rows = [
      {
        createdAt: new Date("2026-01-01"),
        org: { id: "org_a", name: "Org A", slug: "org-a" },
        orgId: "org_a",
        role: "CUSTOMER",
        userId: "user_a",
      },
      {
        createdAt: new Date("2026-02-01"),
        org: { id: "org_b", name: "Org B", slug: "org-b" },
        orgId: "org_b",
        role: "CUSTOMER",
        userId: "user_a",
      },
    ];
    const prisma = buildMockPrisma();
    prisma.orgMembership.findMany = vi.fn((args: { take?: number; where: { orgId?: string } }) =>
      Promise.resolve(
        rows
          .filter((row) => args.where.orgId === undefined || row.orgId === args.where.orgId)
          .slice(0, args.take),
      ),
    ) as never;

    const app = buildApiRoutes({
      memberGuard: requireMemberForDiscovery({
        auth: { api: { getSession: () => Promise.resolve(sessionA) } },
        prisma: prisma as never,
      }),
      routes: { me: buildMeRoutes({ prisma: prisma as never }) },
    });

    const res = await app.fetch(new Request("http://localhost/me"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentOrg: unknown;
      orgs: ReadonlyArray<{ id: string }>;
      role: unknown;
    };
    expect(body.currentOrg).toBeNull();
    expect(body.role).toBeNull();
    expect(body.orgs.map((org) => org.id)).toEqual(["org_a", "org_b"]);
  });

  it("POSTs /orgs to create an org + OWNER membership + product relay", async () => {
    const prisma = buildMockPrisma();
    const app = buildV1WithMocks(buildAllowGuard(), prisma);
    const res = await app.fetch(
      new Request("http://localhost/orgs", {
        body: JSON.stringify({ name: "New", slug: "new-org" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(201);
    expect(prisma.organization.create).toHaveBeenCalled();
    expect(prisma.orgMembership.create).toHaveBeenCalled();
  });

  it("rejects /orgs with a duplicate slug as 409", async () => {
    const prisma = buildMockPrisma();
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        clientVersion: "test",
        code: "P2002",
        meta: { target: ["slug"] },
      }),
    );
    const app = buildV1WithMocks(buildAllowGuard(), prisma);
    const res = await app.fetch(
      new Request("http://localhost/orgs", {
        body: JSON.stringify({ name: "New", slug: "new-org" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(409);
  });
});
