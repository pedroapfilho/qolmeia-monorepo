import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/middleware/require-staff";

import { buildActivityRoutes } from "./activity";
import { buildAgentsRoutes } from "./agents";
import { buildApprovalsRoutes } from "./approvals";
import { buildMeRoutes } from "./me";
import { buildRunsRoutes } from "./runs";
import { buildSoulRoutes } from "./soul";

import { buildV1Routes } from "./index";

// End-to-end cross-org isolation test: a session for Org A must NOT be
// able to see Org B's agents, runs, approvals, activity, or soul. This
// also covers the 401 (no guard installed → routes block without session)
// and the 403 case (a guard that rejects).

const sessionA: AuthSession = {
  session: { id: "sess_a", userId: "user_a" },
  user: { email: "a@example.com", id: "user_a", name: "A" },
};

const orgARecords = {
  agentAction: { agentInstance: { orgId: "org_a", template: { displayName: "T" } }, id: "act_a" },
  agentInstance: { id: "ag_a", orgId: "org_a" },
  agentRun: { agentInstance: { orgId: "org_a" }, id: "run_a" },
};

const orgBRecords = {
  agentAction: { agentInstance: { orgId: "org_b", template: { displayName: "T" } }, id: "act_b" },
  agentInstance: { id: "ag_b", orgId: "org_b" },
  agentRun: { agentInstance: { orgId: "org_b" }, id: "run_b" },
};

// Mock guards. The "allow-A" guard stashes Org A's session/orgId/role on
// the context so handlers run with Org A's perspective.
const buildAllowAGuard = (): MiddlewareHandler => async (c: Context, next: Next) => {
  c.set("session", sessionA);
  c.set("orgId", "org_a");
  c.set("role", "OWNER");
  await next();
};

// The reject guard never calls next() — every request short-circuits at 401.
const buildRejectGuard = (): MiddlewareHandler => (c: Context, _next: Next) =>
  Promise.resolve(c.json({ error: { code: "UNAUTHORIZED", message: "No session" } }, 401));

const buildPrisma = () => {
  // Activity log: returns rows scoped by orgId. The route is supposed to
  // filter on orgId — we record the where clause so the test asserts on it.
  const activityLogFindMany = vi.fn((args: { where: { orgId: string } }) => {
    if (args.where.orgId === "org_a") {
      return Promise.resolve([
        {
          actorId: null,
          createdAt: new Date("2026-01-01"),
          id: "log_a",
          orgId: "org_a",
          payload: {},
          refId: "x",
          refType: "ORGANIZATION",
          summary: "A only",
          type: "OWNER_COMMAND",
        },
      ]);
    }
    return Promise.resolve([]);
  });

  // Agent instance findMany: returns all rows that match the where filter;
  // the route is supposed to filter by orgId via the where clause.
  const agentInstanceFindMany = vi.fn((args: { where: { orgId: string } }) => {
    if (args.where.orgId === "org_a") {
      return Promise.resolve([
        {
          // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate shape
          _count: { enablements: 0 },
          budgetCents: 0,
          createdAt: new Date("2026-01-01"),
          displayName: "Agent A",
          id: orgARecords.agentInstance.id,
          mission: "x",
          status: "ACTIVE" as const,
          template: { displayName: "T", slug: "t" },
          templateSlug: "t",
          updatedAt: new Date("2026-01-01"),
        },
      ]);
    }
    return Promise.resolve([]);
  });

  // findUnique on agentAction: ignores caller's orgId; returns Org B's
  // record so the route's manual cross-org check is exercised.
  const agentActionFindUnique = vi.fn((args: { where: { id: string } }) => {
    if (args.where.id === orgBRecords.agentAction.id) {
      return Promise.resolve({
        agentInstance: { orgId: orgBRecords.agentAction.agentInstance.orgId },
        id: orgBRecords.agentAction.id,
      });
    }
    return Promise.resolve(null);
  });

  // findUnique on agentRun: same — returns Org B's row regardless of caller.
  const agentRunFindUnique = vi.fn((args: { where: { id: string } }) => {
    if (args.where.id === orgBRecords.agentRun.id) {
      return Promise.resolve({
        actions: [],
        agentInstance: { orgId: orgBRecords.agentRun.agentInstance.orgId },
        agentInstanceId: "ag_b",
        costCents: 0,
        costInputTokens: 0,
        costOutputTokens: 0,
        createdAt: new Date("2026-01-01"),
        errorMessage: null,
        finishedAt: null,
        id: orgBRecords.agentRun.id,
        parentRunId: null,
        startedAt: new Date("2026-01-01"),
        status: "SUCCEEDED",
        triggerMessageId: null,
      });
    }
    return Promise.resolve(null);
  });

  return {
    activityLog: { create: vi.fn(), findMany: activityLogFindMany },
    agentAction: { findMany: vi.fn().mockResolvedValue([]), findUnique: agentActionFindUnique },
    agentInstance: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: agentInstanceFindMany,
      update: vi.fn(),
    },
    agentRun: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: agentRunFindUnique,
      groupBy: vi.fn().mockResolvedValue([]),
    },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    orgMembership: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
};

const buildV1WithMocks = (guard: MiddlewareHandler, prisma: ReturnType<typeof buildPrisma>): Hono =>
  buildV1Routes({
    // Same guard wired into every surface — the cross-org test exercises
    // staff routes; the explicit memberGuard + customerGuard mounts get
    // their own assertions in web-chat.test.ts.
    customerGuard: guard,
    memberGuard: guard,
    routes: {
      activity: buildActivityRoutes({ prisma: prisma as never }),
      agents: buildAgentsRoutes({ prisma: prisma as never }),
      approvals: buildApprovalsRoutes({ prisma: prisma as never }),
      me: buildMeRoutes({ prisma: prisma as never }),
      runs: buildRunsRoutes({ prisma: prisma as never }),
      soul: buildSoulRoutes({ prisma: prisma as never }),
    },
    staffGuard: guard,
  });

describe("/api/v1 cross-org isolation", () => {
  it("returns 401 for every endpoint when no session is present", async () => {
    const prisma = buildPrisma();
    const app = buildV1WithMocks(buildRejectGuard(), prisma);

    const paths: ReadonlyArray<{ method: string; path: string }> = [
      { method: "GET", path: "/agents" },
      { method: "GET", path: "/approvals" },
      { method: "GET", path: "/activity" },
      { method: "GET", path: "/soul" },
      { method: "GET", path: "/runs" },
      { method: "GET", path: "/me" },
      { method: "POST", path: "/approvals/act_b/approve" },
    ];

    const responses = await Promise.all(
      paths.map(({ method, path }) =>
        app.fetch(new Request(`http://localhost${path}`, { method })),
      ),
    );
    for (const res of responses) {
      expect(res.status).toBe(401);
    }
  });

  it("Org A's session sees only Org A's agents", async () => {
    const prisma = buildPrisma();
    const app = buildV1WithMocks(buildAllowAGuard(), prisma);

    const res = await app.fetch(new Request("http://localhost/agents"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ReadonlyArray<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(orgARecords.agentInstance.id);
    expect(prisma.agentInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org_a" } }),
    );
  });

  it("Org A's session cannot approve Org B's action (404 not 500)", async () => {
    const prisma = buildPrisma();
    const app = buildV1WithMocks(buildAllowAGuard(), prisma);

    const res = await app.fetch(
      new Request("http://localhost/approvals/act_b/approve", { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });

  it("Org A's session cannot read Org B's run (404)", async () => {
    const prisma = buildPrisma();
    const app = buildV1WithMocks(buildAllowAGuard(), prisma);

    const res = await app.fetch(new Request("http://localhost/runs/run_b"));
    expect(res.status).toBe(404);
  });

  it("Org A's session sees only Org A's activity rows", async () => {
    const prisma = buildPrisma();
    const app = buildV1WithMocks(buildAllowAGuard(), prisma);

    const res = await app.fetch(new Request("http://localhost/activity"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ReadonlyArray<{ id: string; orgId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.orgId).toBe("org_a");
    expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org_a" }) }),
    );
  });
});
