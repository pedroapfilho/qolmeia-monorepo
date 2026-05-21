import type { PrismaClient } from "@repo/db";
import { prisma as defaultPrisma } from "@repo/db";
import { Hono } from "hono";
import { z, ZodError } from "zod";

import { logActivity } from "@/activity/log";
import { notFound, validationError } from "@/lib/api-response";
import { logger as defaultLogger } from "@/lib/logger";
import type { StaffContextVars } from "@/middleware/require-staff";

type AgentsPrisma = Pick<PrismaClient, "activityLog" | "agentInstance" | "agentRun">;

type AgentsRouteDeps = {
  logger?: typeof defaultLogger;
  prisma?: AgentsPrisma;
};

// PATCH body. Only the three owner-facing fields are editable here; the
// template binding, skill enablement, and connector wiring stay in the
// dedicated flows. status accepts only the values in AgentInstanceStatus.
const patchAgentSchema = z
  .object({
    budgetCents: z.number().int().min(0).max(1_000_000_000).optional(),
    mission: z.string().min(1).max(8000).optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one of mission, budgetCents, or status must be provided",
  });

// Underscore prefix matches Prisma's generated relation-count shape; the
// lint suppressions in this file are at the property access sites so the
// rest of the file stays clean.
// eslint-disable-next-line no-underscore-dangle, perfectionist/sort-object-types
type AgentRowWithCount = {
  _count: { enablements: number };
  budgetCents: number;
  createdAt: Date;
  displayName: string;
  id: string;
  mission: string;
  status: "ACTIVE" | "PAUSED";
  template: { displayName: string; slug: string };
  templateSlug: string;
  updatedAt: Date;
};

const summariseAgent = (row: AgentRowWithCount, lastRunAt: Date | null) => ({
  budgetCents: row.budgetCents,
  createdAt: row.createdAt.toISOString(),
  displayName: row.displayName,
  id: row.id,
  isActive: row.status === "ACTIVE",
  lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
  mission: row.mission,

  // eslint-disable-next-line no-underscore-dangle
  skillCount: row._count.enablements,
  status: row.status,
  template: { displayName: row.template.displayName, slug: row.template.slug },
  templateSlug: row.templateSlug,
  updatedAt: row.updatedAt.toISOString(),
});

const buildAgentsRoutes = (deps: AgentsRouteDeps = {}): Hono<{ Variables: StaffContextVars }> => {
  const prisma = deps.prisma ?? defaultPrisma;
  const logger = deps.logger ?? defaultLogger;
  const app = new Hono<{ Variables: StaffContextVars }>();

  // GET /agents — list agents for the current org with a denormalised
  // summary the backoffice can render without a second roundtrip.
  app.get("/", async (c) => {
    const orgId = c.get("orgId");
    const agents = await prisma.agentInstance.findMany({
      include: {
        _count: { select: { enablements: true } },
        template: { select: { displayName: true, slug: true } },
      },
      orderBy: { createdAt: "asc" },
      where: { orgId },
    });

    // Group the latest run timestamps per agent in one query to avoid the
    // N+1 the naive include would produce.
    const agentIds = agents.map((a) => a.id);
    const latestRuns =
      agentIds.length === 0
        ? []
        : await prisma.agentRun.groupBy({
            // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate shape
            _max: { startedAt: true },
            by: ["agentInstanceId"],
            where: { agentInstanceId: { in: agentIds } },
          });
    const lastRunByAgent = new Map<string, Date | null>(
      // eslint-disable-next-line no-underscore-dangle -- Prisma aggregate shape
      latestRuns.map((row) => [row.agentInstanceId, row._max.startedAt ?? null]),
    );

    return c.json({
      items: agents.map((row) => summariseAgent(row, lastRunByAgent.get(row.id) ?? null)),
      nextCursor: null,
    });
  });

  // GET /agents/:id — single agent + last 10 runs.
  app.get("/:id", async (c) => {
    const orgId = c.get("orgId");
    const id = c.req.param("id");
    const agent = await prisma.agentInstance.findFirst({
      include: {
        _count: { select: { enablements: true } },
        template: { select: { displayName: true, slug: true } },
      },
      where: { id, orgId },
    });
    if (!agent) {
      return notFound(c, "Agent not found");
    }

    const recentRuns = await prisma.agentRun.findMany({
      orderBy: { startedAt: "desc" },
      select: {
        costCents: true,
        costInputTokens: true,
        costOutputTokens: true,
        finishedAt: true,
        id: true,
        startedAt: true,
        status: true,
      },
      take: 10,
      where: { agentInstanceId: agent.id },
    });

    const lastRunAt = recentRuns[0]?.startedAt ?? null;

    return c.json({
      ...summariseAgent(agent, lastRunAt),
      recentRuns: recentRuns.map((run) => ({
        costCents: run.costCents,
        costInputTokens: run.costInputTokens,
        costOutputTokens: run.costOutputTokens,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        id: run.id,
        startedAt: run.startedAt.toISOString(),
        status: run.status,
      })),
    });
  });

  // PATCH /agents/:id — mission / budget / status. The owner edits these
  // a few times per agent; everything else (template, skills, connectors)
  // ships through dedicated flows.
  app.patch("/:id", async (c) => {
    const orgId = c.get("orgId");
    const session = c.get("session");
    const id = c.req.param("id");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return validationError(
        c,
        new ZodError([
          { code: "custom", input: undefined, message: "Invalid JSON body", path: [] },
        ]),
      );
    }

    const parsed = patchAgentSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(c, parsed.error);
    }

    const existing = await prisma.agentInstance.findFirst({
      select: { displayName: true, id: true },
      where: { id, orgId },
    });
    if (!existing) {
      return notFound(c, "Agent not found");
    }

    const updated = await prisma.agentInstance.update({
      data: parsed.data,
      include: {
        _count: { select: { enablements: true } },
        template: { select: { displayName: true, slug: true } },
      },
      where: { id: existing.id },
    });

    await logActivity({
      actorId: session.user.id,
      orgId,
      payload: {
        agentInstanceId: updated.id,
        changes: parsed.data,
        decidedByUserId: session.user.id,
      },
      prisma,
      refId: updated.id,
      refType: "ORGANIZATION",
      summary: `Agente ${updated.displayName} atualizado por ${session.user.email}`,
      type: "OWNER_COMMAND",
    });

    logger.info(
      { agentInstanceId: updated.id, changes: parsed.data, orgId, userId: session.user.id },
      "v1.agents.patch",
    );

    return c.json(summariseAgent(updated, null));
  });

  return app;
};

export { buildAgentsRoutes, patchAgentSchema };
export type { AgentsRouteDeps };
