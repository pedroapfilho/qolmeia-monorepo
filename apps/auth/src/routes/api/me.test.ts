import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildMeRoutes } from "./me";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "Pedro" },
};

const buildAppWithGuard = (vars: StaffContextVars, routes: ReturnType<typeof buildMeRoutes>) => {
  const app = new Hono<{ Variables: StaffContextVars }>();
  app.use("*", (c, next) => {
    c.set("session", vars.session);
    c.set("orgId", vars.orgId);
    c.set("role", vars.role);
    return next();
  });
  app.route("/", routes);
  return app;
};

describe("GET /me", () => {
  it("returns the user, all orgs, and the current org", async () => {
    const db = {
      query: {
        orgMembership: {
          findMany: vi.fn().mockResolvedValue([
            {
              createdAt: new Date("2026-01-01"),
              org: { id: "org_a", name: "Salon A", slug: "salon-a" },
              orgId: "org_a",
              role: "OWNER",
            },
            {
              createdAt: new Date("2026-02-01"),
              org: { id: "org_b", name: "Salon B", slug: "salon-b" },
              orgId: "org_b",
              role: "STAFF",
            },
          ]),
        },
        user: {
          findFirst: vi.fn().mockResolvedValue({
            displayName: null,
            email: "u@example.com",
            emailVerified: true,
            id: "user_1",
            image: null,
            name: "Pedro",
            username: "pedro",
          }),
        },
      },
    } as never;

    const routes = buildMeRoutes({ db });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      currentOrg: { id: string; role: string };
      orgs: ReadonlyArray<{ id: string; role: string }>;
      role: string;
      user: { email: string };
    };
    expect(body.user.email).toBe("u@example.com");
    expect(body.role).toBe("OWNER");
    expect(body.currentOrg).toEqual({
      id: "org_a",
      name: "Salon A",
      role: "OWNER",
      slug: "salon-a",
    });
    expect(body.orgs).toHaveLength(2);
  });

  it("returns null for currentOrg when there's no matching membership row", async () => {
    const db = {
      query: {
        orgMembership: { findMany: vi.fn().mockResolvedValue([]) },
        user: {
          findFirst: vi.fn().mockResolvedValue({
            displayName: null,
            email: "u@example.com",
            emailVerified: true,
            id: "user_1",
            image: null,
            name: "Pedro",
            username: "pedro",
          }),
        },
      },
    } as never;

    const routes = buildMeRoutes({ db });
    const app = buildAppWithGuard({ orgId: "org_missing", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    const body = (await res.json()) as { currentOrg: unknown };
    expect(body.currentOrg).toBeNull();
  });

  it("returns 404 when the user row has been deleted under us", async () => {
    const db = {
      query: {
        orgMembership: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findFirst: vi.fn().mockResolvedValue(undefined) },
      },
    } as never;

    const routes = buildMeRoutes({ db });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(404);
  });
});
