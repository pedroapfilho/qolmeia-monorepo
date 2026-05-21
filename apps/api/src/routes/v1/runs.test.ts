import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession, StaffContextVars } from "@/middleware/require-staff";

import { buildRunsRoutes } from "./runs";

const session: AuthSession = {
  session: { id: "sess_1", userId: "user_1" },
  user: { email: "u@example.com", id: "user_1", name: "U" },
};

const buildRun = (overrides: Partial<{ id: string; startedAt: Date; status: string }> = {}) => ({
  agentInstanceId: "ag_1",
  costCents: 0,
  costInputTokens: 0,
  costOutputTokens: 0,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  errorMessage: null,
  finishedAt: null,
  id: overrides.id ?? "run_1",
  parentRunId: null,
  startedAt: overrides.startedAt ?? new Date("2026-03-01T00:00:00.000Z"),
  status: overrides.status ?? "SUCCEEDED",
  triggerMessageId: "msg_1",
});

const buildAppWithGuard = (vars: StaffContextVars, routes: ReturnType<typeof buildRunsRoutes>) => {
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

describe("GET /runs", () => {
  it("lists runs for the current org", async () => {
    const findMany = vi.fn().mockResolvedValue([buildRun()]);
    const prisma = { agentRun: { findMany, findUnique: vi.fn() } } as never;
    const routes = buildRunsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: ReadonlyArray<{ id: string }>;
      nextCursor: string | null;
    };
    expect(body.items[0]!.id).toBe("run_1");
    expect(findMany.mock.calls[0]![0].where).toMatchObject({
      agentInstance: { orgId: "org_a" },
    });
  });

  it("filters by agentInstanceId and status when provided", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { agentRun: { findMany, findUnique: vi.fn() } } as never;
    const routes = buildRunsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    await app.fetch(new Request("http://localhost/?agentInstanceId=ag_42&status=FAILED"));
    const where = findMany.mock.calls[0]![0].where as {
      agentInstanceId: string;
      status: string;
    };
    expect(where.agentInstanceId).toBe("ag_42");
    expect(where.status).toBe("FAILED");
  });

  it("silently drops unknown status filter values", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { agentRun: { findMany, findUnique: vi.fn() } } as never;
    const routes = buildRunsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    await app.fetch(new Request("http://localhost/?status=NOPE"));
    expect(findMany.mock.calls[0]![0].where.status).toBeUndefined();
  });
});

describe("GET /runs/:id", () => {
  it("returns the run with its action tree", async () => {
    const run = {
      ...buildRun(),
      actions: [
        {
          agentInstanceId: "ag_1",
          costCents: 0,
          createdAt: new Date("2026-03-01T00:00:01.000Z"),
          decidedAt: null,
          decidedByUserId: null,
          errorMessage: null,
          executedAt: null,
          id: "act_1",
          parentActionId: null,
          proposedInput: { foo: "bar" },
          proposedSummary: "x",
          resultJson: null,
          skillId: "extractSoul",
          status: "EXECUTED",
        },
      ],
      agentInstance: { orgId: "org_a" },
    };
    const prisma = {
      agentRun: { findMany: vi.fn(), findUnique: vi.fn().mockResolvedValue(run) },
    } as never;
    const routes = buildRunsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/run_1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: ReadonlyArray<{ id: string }>; id: string };
    expect(body.id).toBe("run_1");
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]!.id).toBe("act_1");
  });

  it("returns 404 when the run belongs to another org", async () => {
    const prisma = {
      agentRun: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          ...buildRun(),
          actions: [],
          agentInstance: { orgId: "org_other" },
        }),
      },
    } as never;
    const routes = buildRunsRoutes({ prisma });
    const app = buildAppWithGuard({ orgId: "org_a", role: "OWNER", session }, routes);

    const res = await app.fetch(new Request("http://localhost/run_1"));
    expect(res.status).toBe(404);
  });
});
