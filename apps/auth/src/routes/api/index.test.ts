import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/middleware/require-staff";

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

const buildMockDb = () => {
  let insertCallCount = 0;

  const db = {
    insert: vi.fn((_table: unknown) => {
      insertCallCount++;
      const callIndex = insertCallCount;
      return {
        values: (data: unknown) => ({
          returning: () => {
            if (callIndex % 2 === 1) {
              const d = data as { name: string; slug: string };
              return Promise.resolve([{ id: "new_org", name: d.name, slug: d.slug }]);
            }
            return Promise.resolve([{}]);
          },
        }),
      };
    }),
    query: {
      organization: {
        findFirst: vi.fn().mockResolvedValue(undefined),
      },
      orgMembership: {
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
        findFirst: vi.fn().mockResolvedValue({
          displayName: null,
          email: "a@example.com",
          emailVerified: true,
          id: "user_a",
          image: null,
          name: "A",
          username: null,
        }),
      },
    },
    transaction: vi.fn((callback: (tx: typeof db) => Promise<unknown>): Promise<unknown> => {
      insertCallCount = 0;
      return callback(db);
    }),
  };
  return db;
};

const buildV1WithMocks = (guard: MiddlewareHandler, db: ReturnType<typeof buildMockDb>): Hono =>
  buildApiRoutes({
    memberGuard: guard,
    routes: {
      me: buildMeRoutes({ db: db as never }),
      orgs: buildOrgsRoutes({
        auth: { api: { getSession: () => Promise.resolve(sessionA) } },
        db: db as never,
        fetch: vi.fn().mockResolvedValue(new Response("OK", { status: 201 })),
      }),
    },
  });

describe("/api post-P7.2 surface", () => {
  it("returns 401 from /me when guard rejects", async () => {
    const app = buildV1WithMocks(buildRejectGuard(), buildMockDb());
    const res = await app.fetch(new Request("http://localhost/me"));
    expect(res.status).toBe(401);
  });

  it("returns the current user + currentOrg via /me", async () => {
    const app = buildV1WithMocks(buildAllowGuard(), buildMockDb());
    const res = await app.fetch(new Request("http://localhost/me"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { currentOrg: { id: string }; user: { email: string } };
    expect(body.currentOrg.id).toBe("org_a");
    expect(body.user.email).toBe("a@example.com");
  });

  it("POSTs /orgs to create an org + OWNER membership + D1 relay", async () => {
    const db = buildMockDb();
    const app = buildV1WithMocks(buildAllowGuard(), db);
    const res = await app.fetch(
      new Request("http://localhost/orgs", {
        body: JSON.stringify({ name: "New", slug: "new-org" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalled();
  });

  it("rejects /orgs with a duplicate slug as 409", async () => {
    const db = buildMockDb();
    db.query.organization.findFirst.mockResolvedValueOnce({
      id: "existing",
      name: "X",
      slug: "new-org",
    });
    const app = buildV1WithMocks(buildAllowGuard(), db);
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
