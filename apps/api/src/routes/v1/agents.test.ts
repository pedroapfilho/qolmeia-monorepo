import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildAgentsRoutes } from "./agents";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

const buildAgentRow = (overrides: Partial<{ id: string; status: "ACTIVE" | "PAUSED" }> = {}) => ({
  _count: { enablements: 3 },
  budgetCents: 0,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  displayName: "Marketer",
  id: overrides.id ?? "ag_1",
  mission: "Plan campaigns",
  status: overrides.status ?? ("ACTIVE" as const),
  template: { displayName: "Marketing Strategist", slug: "marketing-strategist" },
  templateSlug: "marketing-strategist",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

const stubLogger = () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() });

const buildAppWithGuard = (
  vars: StaffContextVars,
  routes: ReturnType<typeof buildAgentsRoutes>,
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

describe("GET /agents", () => {
  it("returns the org's agents with skill count and last run timestamp", async () => {
    const row = buildAgentRow();
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([row]),
        update: vi.fn(),
      },
      agentRun: {
        findMany: vi.fn(),
        groupBy: vi.fn().mockResolvedValue([
          // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate shape
          { _max: { startedAt: new Date("2026-02-01T00:00:00.000Z") }, agentInstanceId: "ag_1" },
        ]),
      },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{
        id: string;
        isActive: boolean;
        lastRunAt: string;
        skillCount: number;
      }>;
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe("ag_1");
    expect(body.items[0]!.isActive).toBe(true);
    expect(body.items[0]!.skillCount).toBe(3);
    expect(body.items[0]!.lastRunAt).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("GET /agents/:id", () => {
  it("returns the agent with the 10 most recent runs", async () => {
    const row = buildAgentRow();
    const recent = [
      {
        costCents: 0,
        costInputTokens: 1,
        costOutputTokens: 2,
        finishedAt: new Date("2026-02-01T00:01:00.000Z"),
        id: "run_1",
        startedAt: new Date("2026-02-01T00:00:00.000Z"),
        status: "SUCCEEDED",
      },
    ];
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: { findFirst: vi.fn().mockResolvedValue(row) },
      agentRun: { findMany: vi.fn().mockResolvedValue(recent) },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/ag_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; recentRuns: ReadonlyArray<{ id: string }> };
    expect(body.id).toBe("ag_1");
    expect(body.recentRuns).toHaveLength(1);
    expect(body.recentRuns[0]!.id).toBe("run_1");
  });

  it("returns 404 when the agent doesn't belong to the org", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: { findFirst: vi.fn().mockResolvedValue(null) },
      agentRun: { findMany: vi.fn() },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/ag_99"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Agent not found" },
    });
  });
});

describe("PATCH /agents/:id", () => {
  it("updates mission/budget/status and emits an ActivityLog row", async () => {
    const row = buildAgentRow();
    const activityCreate = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({ ...row, budgetCents: 50_000 });
    const prisma = {
      activityLog: { create: activityCreate },
      agentInstance: {
        findFirst: vi.fn().mockResolvedValue({ displayName: "Marketer", id: "ag_1" }),
        update,
      },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/ag_1", {
        body: JSON.stringify({ budgetCents: 50_000 }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { budgetCents: 50_000 } }));
    expect(activityCreate).toHaveBeenCalledOnce();
    const activityArg = activityCreate.mock.calls[0]![0] as {
      data: { orgId: string; type: string };
    };
    expect(activityArg.data.type).toBe("OWNER_COMMAND");
    expect(activityArg.data.orgId).toBe("org_a");
  });

  it("returns 422 when no editable field is provided", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: { findFirst: vi.fn(), update: vi.fn() },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/ag_1", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for a malformed status value", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: { findFirst: vi.fn(), update: vi.fn() },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/ag_1", {
        body: JSON.stringify({ status: "ARCHIVED" }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(res.status).toBe(422);
  });

  it("returns 404 when the agent is not in the caller's org", async () => {
    const prisma = {
      activityLog: { create: vi.fn() },
      agentInstance: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() },
    } as never;

    const routes = buildAgentsRoutes({ logger: stubLogger() as never, prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(
      new Request("http://localhost/ag_99", {
        body: JSON.stringify({ budgetCents: 10 }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(res.status).toBe(404);
  });
});
