import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildActivityRoutes } from "./activity";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

const buildLog = (overrides: Partial<{ createdAt: Date; id: string; type: string }> = {}) => ({
  actorId: null,
  createdAt: overrides.createdAt ?? new Date("2026-03-01T00:00:00.000Z"),
  id: overrides.id ?? "log_1",
  orgId: "org_a",
  payload: {},
  refId: "x",
  refType: "ORGANIZATION",
  summary: "Something happened",
  type: overrides.type ?? "OWNER_COMMAND",
});

const buildAppWithGuard = (
  vars: StaffContextVars,
  routes: ReturnType<typeof buildActivityRoutes>,
) => {
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

describe("GET /activity", () => {
  it("returns the org's activity log, newest first", async () => {
    const findMany = vi.fn().mockResolvedValue([buildLog()]);
    const prisma = { activityLog: { findMany } } as never;
    const routes = buildActivityRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{ id: string; summary: string }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.summary).toBe("Something happened");
    expect(body.nextCursor).toBeNull();
    expect(findMany.mock.calls[0]![0].where).toMatchObject({ orgId: "org_a" });
    expect(findMany.mock.calls[0]![0].take).toBe(51);
  });

  it("emits a nextCursor when the peek row exists", async () => {
    const rows = [buildLog({ id: "a" }), buildLog({ id: "b" }), buildLog({ id: "c" })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = { activityLog: { findMany } } as never;

    const routes = buildActivityRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    const res = await app.fetch(new Request("http://localhost/?limit=2"));
    const body = (await res.json()) as { items: ReadonlyArray<unknown>; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
  });

  it("honours type + refType filters and drops unknown enum values", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;

    const routes = buildActivityRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    await app.fetch(
      new Request("http://localhost/?type=OWNER_COMMAND,NOPE&refType=ORGANIZATION,GARBAGE"),
    );
    const where = findMany.mock.calls[0]![0].where as {
      refType: { in: ReadonlyArray<string> };
      type: { in: ReadonlyArray<string> };
    };
    expect(where.type.in).toEqual(["OWNER_COMMAND"]);
    expect(where.refType.in).toEqual(["ORGANIZATION"]);
  });

  it("caps the limit at 200", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { activityLog: { findMany } } as never;
    const routes = buildActivityRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "STAFF", session }, routes);

    await app.fetch(new Request("http://localhost/?limit=9999"));
    expect(findMany.mock.calls[0]![0].take).toBe(201);
  });
});
