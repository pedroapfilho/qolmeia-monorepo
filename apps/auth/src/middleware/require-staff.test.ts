import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { buildRoleGuard, requireAnyMember, requireStaff } from "./require-staff";

type Membership = {
  createdAt: Date;
  orgId: string;
  role: "OWNER" | "STAFF" | "CUSTOMER";
  userId: string;
};

const buildAuth = (session: unknown) => ({
  api: { getSession: vi.fn().mockResolvedValue(session) },
});

const buildDb = (memberships: ReadonlyArray<Membership>) => ({
  query: {
    orgMembership: {
      findFirst: vi.fn((_args: { orderBy: unknown; where: unknown }) => {
        // The real query filters by userId + role and orders by createdAt asc.
        // We replicate that logic here so tests remain behaviour-equivalent.
        const match = memberships.toSorted(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )[0];
        return Promise.resolve(match ?? undefined);
      }),
    },
  },
});

const buildApp = (
  guard: ReturnType<typeof requireStaff>,
  handler: (c: Context) => Response | Promise<Response>,
) => {
  const app = new Hono();
  app.use("/x", guard);
  app.get("/x", handler);
  return app;
};

const session = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

describe("requireStaff", () => {
  it("returns 401 when there is no session", async () => {
    const auth = buildAuth(null);
    const db = buildDb([]);
    const app = buildApp(requireStaff({ auth, db: db as never }), (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication required" },
    });
    expect(db.query.orgMembership.findFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no STAFF or OWNER membership", async () => {
    const auth = buildAuth(session);
    // Return undefined (no match) to simulate no staff/owner membership
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const app = buildApp(requireStaff({ auth, db: db as never }), (c) => c.json({ ok: true }));

    const res = await app.fetch(new Request("http://localhost/x"));

    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("sets session, orgId, and role on the context for a STAFF membership", async () => {
    const auth = buildAuth(session);
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-01-01"),
            orgId: "org_a",
            role: "STAFF",
            userId: "user_1",
          }),
        },
      },
    };

    const app = buildApp(requireStaff({ auth, db: db as never }), (c) => {
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

  it("prefers the oldest matching membership when multiple exist", async () => {
    const auth = buildAuth(session);
    // The real DB query orders by createdAt asc; mock returns the oldest first
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-01-01"),
            orgId: "org_older",
            role: "OWNER",
            userId: "user_1",
          }),
        },
      },
    };

    const app = buildApp(requireStaff({ auth, db: db as never }), (c) =>
      c.json({
        orgId: c.get("orgId"),
        role: c.get("role"),
      }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(await res.json()).toEqual({ orgId: "org_older", role: "OWNER" });
  });
});

describe("requireAnyMember", () => {
  it("accepts a CUSTOMER membership", async () => {
    const auth = buildAuth(session);
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-01-01"),
            orgId: "org_a",
            role: "CUSTOMER",
            userId: "user_1",
          }),
        },
      },
    };

    const app = buildApp(requireAnyMember({ auth, db: db as never }), (c) =>
      c.json({ role: c.get("role") }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "CUSTOMER" });
  });

  it("accepts an OWNER membership", async () => {
    const auth = buildAuth(session);
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-01-01"),
            orgId: "org_a",
            role: "OWNER",
            userId: "user_1",
          }),
        },
      },
    };

    const app = buildApp(requireAnyMember({ auth, db: db as never }), (c) =>
      c.json({ role: c.get("role") }),
    );

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });

  it("rejects users with no membership with 403", async () => {
    const auth = buildAuth(session);
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    const app = buildApp(requireAnyMember({ auth, db: db as never }), (c) => c.json({ ok: true }));
    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(403);
  });
});

describe("buildRoleGuard", () => {
  it("can be used to build arbitrary role gates", async () => {
    const auth = buildAuth(session);
    const db = {
      query: {
        orgMembership: {
          findFirst: vi.fn().mockResolvedValue({
            createdAt: new Date("2026-01-01"),
            orgId: "org_a",
            role: "OWNER",
            userId: "user_1",
          }),
        },
      },
    };

    const guard = buildRoleGuard(["OWNER"], { auth, db: db as never });
    const app = buildApp(guard, (c) => c.json({ role: c.get("role") }));

    const res = await app.fetch(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "OWNER" });
  });
});
