import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { buildRoleGuard, requireAnyMember, requireMemberForDiscovery } from "./require-staff";

type Membership = {
  createdAt: Date;
  orgId: string;
  role: "OWNER" | "STAFF" | "CUSTOMER";
  userId: string;
};

type AuthSession = {
  session: { id: string; userId: string };
  user: { email: string; id: string; name: string };
} | null;

const buildAuth = (session: AuthSession) => ({
  api: { getSession: vi.fn().mockResolvedValue(session) },
});

type MembershipWhere = {
  orgId?: string;
  role: { in: ReadonlyArray<string> };
  userId: string;
};

const matching = (
  memberships: ReadonlyArray<Membership>,
  where: MembershipWhere,
): ReadonlyArray<Membership> =>
  memberships
    .filter((m) => {
      const acceptedRole = new Set(where.role.in).has(m.role);
      const sameOrg = where.orgId === undefined || m.orgId === where.orgId;
      return m.userId === where.userId && acceptedRole && sameOrg;
    })
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

const buildPrisma = (memberships: ReadonlyArray<Membership>) => ({
  orgMembership: {
    findFirst: vi.fn((args: { where: MembershipWhere }) =>
      Promise.resolve(matching(memberships, args.where)[0] ?? null),
    ),
    findMany: vi.fn((args: { take?: number; where: MembershipWhere }) =>
      Promise.resolve(matching(memberships, args.where).slice(0, args.take)),
    ),
  },
});

const buildApp = (
  guard: ReturnType<typeof requireAnyMember>,
  handler: (c: Context) => Response | Promise<Response>,
) => {
  const app = new Hono();
  app.use("/x", (c, next) => {
    c.set("log", { error: vi.fn() } as never);
    return next();
  });
  app.use("/x", guard);
  app.get("/x", handler);
  return app;
};

const session = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

const staffGuard = (deps: Parameters<typeof buildRoleGuard>[1]) =>
  buildRoleGuard(["OWNER", "STAFF"], deps);

describe("buildRoleGuard: OWNER + STAFF", () => {
  it("returns 401 when there is no session", async () => {
    const auth = buildAuth(null);
    const prisma = buildPrisma([]);
    const app = buildApp(staffGuard({ auth, prisma: prisma as never }), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    expect(prisma.orgMembership.findFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no STAFF or OWNER membership", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([
      {
        createdAt: new Date("2026-01-01"),
        orgId: "org_a",
        role: "CUSTOMER",
        userId: "user_1",
      },
    ]);
    const app = buildApp(staffGuard({ auth, prisma: prisma as never }), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("sets session, orgId, and role on the context for a STAFF membership", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([
      {
        createdAt: new Date("2026-01-01"),
        orgId: "org_a",
        role: "STAFF",
        userId: "user_1",
      },
    ]);

    const app = buildApp(staffGuard({ auth, prisma: prisma as never }), (c) => {
      return c.json({
        orgId: c.get("orgId"),
        role: c.get("role"),
        userId: (c.get("session") as typeof session).user.id,
      });
    });

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "org_a",
      role: "STAFF",
      userId: "user_1",
    });
  });

  it("returns 503 when the auth service is unavailable", async () => {
    const auth = {
      api: { getSession: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) },
    };
    const prisma = buildPrisma([]);
    const app = buildApp(staffGuard({ auth, prisma: prisma as never }), (c) =>
      c.json({ ok: true }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Authentication service unavailable");
    expect(prisma.orgMembership.findFirst).not.toHaveBeenCalled();
  });
});

const MULTI_ORG_MEMBERSHIPS: ReadonlyArray<Membership> = [
  { createdAt: new Date("2026-02-01"), orgId: "org_newer", role: "STAFF", userId: "user_1" },
  { createdAt: new Date("2026-01-01"), orgId: "org_older", role: "OWNER", userId: "user_1" },
];

const SINGLE_ORG_MEMBERSHIPS: ReadonlyArray<Membership> = [
  { createdAt: new Date("2026-01-01"), orgId: "org_only", role: "OWNER", userId: "user_1" },
];

const buildTenantApp = (memberships: ReadonlyArray<Membership>) =>
  buildApp(
    staffGuard({ auth: buildAuth(session), prisma: buildPrisma(memberships) as never }),
    (c) => c.json({ orgId: c.get("orgId"), role: c.get("role") }),
  );

const getAs = (app: ReturnType<typeof buildTenantApp>, orgId?: string) =>
  app.fetch(
    new Request("http://localhost/x", {
      headers: orgId === undefined ? {} : { "X-Org-Id": orgId },
    }),
  );

describe("tenant resolution", () => {
  it("returns 400 for a multi-org user that sent no X-Org-Id", async () => {
    const app = buildTenantApp(MULTI_ORG_MEMBERSHIPS);

    const res = await getAs(app);

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "ORG_ID_REQUIRED" },
    });
  });

  it("resolves the requested org for a multi-org user", async () => {
    const app = buildTenantApp(MULTI_ORG_MEMBERSHIPS);

    const res = await getAs(app, "org_newer");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_newer", role: "STAFF" });
  });

  it("returns 403 for an org the caller is not a member of", async () => {
    const app = buildTenantApp(MULTI_ORG_MEMBERSHIPS);

    const res = await getAs(app, "org_someone_else");

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string; message: string } }).toMatchObject({
      error: { code: "FORBIDDEN", message: expect.stringContaining("requested organization") },
    });
  });

  it("still resolves a single-org user that sent no X-Org-Id", async () => {
    const app = buildTenantApp(SINGLE_ORG_MEMBERSHIPS);

    const res = await getAs(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_only", role: "OWNER" });
  });

  it("ignores a blank X-Org-Id rather than treating it as an org", async () => {
    const app = buildTenantApp(SINGLE_ORG_MEMBERSHIPS);

    const res = await getAs(app, "   ");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_only", role: "OWNER" });
  });
});

describe("requireMemberForDiscovery", () => {
  const buildDiscoveryApp = (memberships: ReadonlyArray<Membership>) =>
    buildApp(
      requireMemberForDiscovery({
        auth: buildAuth(session),
        prisma: buildPrisma(memberships) as never,
      }),
      (c) => c.json({ orgId: c.get("orgId"), role: c.get("role") }),
    );

  it("lets a multi-org user through with no X-Org-Id so it can read its org list", async () => {
    const res = await getAs(buildDiscoveryApp(MULTI_ORG_MEMBERSHIPS));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: null, role: null });
  });

  it("still resolves the named org for a multi-org user", async () => {
    const res = await getAs(buildDiscoveryApp(MULTI_ORG_MEMBERSHIPS), "org_newer");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_newer", role: "STAFF" });
  });

  it("still resolves the only org for a single-org user", async () => {
    const res = await getAs(buildDiscoveryApp(SINGLE_ORG_MEMBERSHIPS));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_only", role: "OWNER" });
  });

  it("still returns 403 when the caller belongs to no org at all", async () => {
    const res = await getAs(buildDiscoveryApp([]));

    expect(res.status).toBe(403);
  });

  it("still returns 403 for an org the caller is not a member of", async () => {
    const res = await getAs(buildDiscoveryApp(MULTI_ORG_MEMBERSHIPS), "org_someone_else");

    expect(res.status).toBe(403);
  });
});

describe("requireAnyMember", () => {
  it("accepts a CUSTOMER membership", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([
      {
        createdAt: new Date("2026-01-01"),
        orgId: "org_a",
        role: "CUSTOMER",
        userId: "user_1",
      },
    ]);

    const app = buildApp(requireAnyMember({ auth, prisma: prisma as never }), (c) =>
      c.json({ role: c.get("role") }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "CUSTOMER" });
  });

  it("accepts an OWNER membership", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([
      {
        createdAt: new Date("2026-01-01"),
        orgId: "org_a",
        role: "OWNER",
        userId: "user_1",
      },
    ]);

    const app = buildApp(requireAnyMember({ auth, prisma: prisma as never }), (c) =>
      c.json({ role: c.get("role") }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });

  it("rejects users with no membership with 403", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([]);
    const app = buildApp(requireAnyMember({ auth, prisma: prisma as never }), (c) =>
      c.json({ ok: true }),
    );
    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(403);
  });
});

describe("buildRoleGuard", () => {
  it("can be used to build arbitrary role gates", async () => {
    const auth = buildAuth(session);
    const prisma = buildPrisma([
      {
        createdAt: new Date("2026-01-01"),
        orgId: "org_a",
        role: "OWNER",
        userId: "user_1",
      },
    ]);

    const guard = buildRoleGuard(["OWNER"], { auth, prisma: prisma as never });
    const app = buildApp(guard, (c) => c.json({ role: c.get("role") }));

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });
});
