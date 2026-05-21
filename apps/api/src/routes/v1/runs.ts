import type { AgentRunStatus, PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";

import { buildListResponse, notFound, parsePagination } from "@/lib/api-response";
import type { StaffContextVars } from "@/middleware/require-staff";

type RunsPrisma = Pick<PrismaClient, "agentRun">;

type RunsRouteDeps = {
  prisma?: RunsPrisma;
};

const VALID_STATUSES: ReadonlySet<AgentRunStatus> = new Set<AgentRunStatus>([
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

const parseStatus = (raw: string | undefined): AgentRunStatus | null => {
  if (!raw) {
    return null;
  }
  return VALID_STATUSES.has(raw as AgentRunStatus) ? (raw as AgentRunStatus) : null;
};

const serialiseRun = (run: {
  agentInstanceId: string;
  costCents: number;
  costInputTokens: number;
  costOutputTokens: number;
  createdAt: Date;
  errorMessage: string | null;
  finishedAt: Date | null;
  id: string;
  parentRunId: string | null;
  startedAt: Date;
  status: AgentRunStatus;
  triggerMessageId: string | null;
}) => ({
  agentInstanceId: run.agentInstanceId,
  costCents: run.costCents,
  costInputTokens: run.costInputTokens,
  costOutputTokens: run.costOutputTokens,
  createdAt: run.createdAt.toISOString(),
  errorMessage: run.errorMessage,
  finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  id: run.id,
  parentRunId: run.parentRunId,
  startedAt: run.startedAt.toISOString(),
  status: run.status,
  triggerMessageId: run.triggerMessageId,
});

const buildRunsRoutes = (deps: RunsRouteDeps = {}): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /runs — paginated AgentRun rows for the current org. Optionally
  // filter by agentInstanceId and/or status.
  app.get("/", async (c) => {
    const orgId = c.get("orgId");
    const { cursorDate, limit } = parsePagination({
      cursor: c.req.query("cursor"),
      defaultLimit: 20,
      limit: c.req.query("limit"),
      maxLimit: 100,
    });
    const agentInstanceId = c.req.query("agentInstanceId");
    const status = parseStatus(c.req.query("status"));

    const rows = await prisma.agentRun.findMany({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      where: {
        agentInstance: { orgId },
        ...(agentInstanceId ? { agentInstanceId } : {}),
        ...(status ? { status } : {}),
        ...(cursorDate ? { startedAt: { lt: cursorDate } } : {}),
      },
    });

    // Use startedAt as the cursor field (matches the orderBy).
    const response = buildListResponse(rows, limit, (row) => row.startedAt);
    return c.json({
      items: response.items.map(serialiseRun),
      nextCursor: response.nextCursor,
    });
  });

  // GET /runs/:id — single run + full action tree. Verifies orgId match
  // through the agent instance relation; 404 covers both not-found and
  // cross-org to avoid leaking existence.
  app.get("/:id", async (c) => {
    const orgId = c.get("orgId");
    const id = c.req.param("id");
    const run = await prisma.agentRun.findUnique({
      include: {
        actions: {
          orderBy: { createdAt: "asc" },
        },
        agentInstance: { select: { orgId: true } },
      },
      where: { id },
    });
    if (!run || run.agentInstance.orgId !== orgId) {
      return notFound(c, "Run not found");
    }
    return c.json({
      ...serialiseRun(run),
      actions: run.actions.map((action) => ({
        agentInstanceId: action.agentInstanceId,
        costCents: action.costCents,
        createdAt: action.createdAt.toISOString(),
        decidedAt: action.decidedAt ? action.decidedAt.toISOString() : null,
        decidedByUserId: action.decidedByUserId,
        errorMessage: action.errorMessage,
        executedAt: action.executedAt ? action.executedAt.toISOString() : null,
        id: action.id,
        parentActionId: action.parentActionId,
        proposedInput: action.proposedInput,
        proposedSummary: action.proposedSummary,
        resultJson: action.resultJson,
        skillId: action.skillId,
        status: action.status,
      })),
    });
  });

  return app;
};

export { buildRunsRoutes };
export type { RunsRouteDeps };
