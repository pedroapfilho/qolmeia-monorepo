import { createHash } from "node:crypto";

import type { AgentRun, PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";

import type { ContextSnapshot } from "./context-snapshot";
import type { AgentRunResult } from "./dispatcher";

type AgentRunPrisma = Pick<PrismaClient, "activityLog" | "agentRun">;

// Optional orgId + agent context lets the run lifecycle emit ActivityLog
// rows alongside the AgentRun row. Wired in by every call site today; left
// optional so the helper still works for narrower callers without forcing
// a churn in the test mocks.
type RunActivityContext = {
  agentDisplayName?: string;
  orgId?: string;
  templateSlug?: string;
};

type CreateAgentRunArgs = {
  activityContext?: RunActivityContext;
  agentInstanceId: string;
  contextSnapshot: ContextSnapshot;
  parentRunId?: string | null;
  prisma: AgentRunPrisma;
  systemPrompt: string;
  triggerMessageId?: string | null;
};

const createAgentRun = async (args: CreateAgentRunArgs): Promise<AgentRun> => {
  const run = await args.prisma.agentRun.create({
    data: {
      agentInstanceId: args.agentInstanceId,
      contextSnapshot: args.contextSnapshot as unknown as object,
      parentRunId: args.parentRunId ?? null,
      systemPrompt: args.systemPrompt,
      triggerMessageId: args.triggerMessageId ?? null,
    },
  });

  if (args.activityContext?.orgId !== undefined) {
    const displayName = args.activityContext.agentDisplayName ?? "agente";
    await logActivity({
      orgId: args.activityContext.orgId,
      payload: {
        agentInstanceId: args.agentInstanceId,
        mission: args.contextSnapshot.mission,
        parentRunId: args.parentRunId ?? null,
        templateSlug: args.activityContext.templateSlug ?? null,
        triggerMessageId: args.triggerMessageId ?? null,
      },
      prisma: args.prisma,
      refId: run.id,
      refType: "AGENT_RUN",
      summary: `Agente ${displayName} iniciou`,
      type: "AGENT_RUN_STARTED",
    });
  }

  return run;
};

type FinalizeAgentRunArgs = {
  activityContext?: RunActivityContext;
  error?: Error | null;
  prisma: AgentRunPrisma;
  result?: AgentRunResult | null;
  runId: string;
};

const finalizeAgentRun = async (args: FinalizeAgentRunArgs): Promise<AgentRun> => {
  const usage = args.result?.usage;
  const finishedAt = new Date();
  const run = await args.prisma.agentRun.update({
    data: {
      costInputTokens: usage?.inputTokens ?? 0,
      costOutputTokens: usage?.outputTokens ?? 0,
      errorMessage: args.error ? args.error.message : null,
      finishedAt,
      status: args.error ? "FAILED" : "SUCCEEDED",
    },
    where: { id: args.runId },
  });

  if (args.activityContext?.orgId !== undefined) {
    const displayName = args.activityContext.agentDisplayName ?? "agente";
    const durationMs =
      run.startedAt instanceof Date ? finishedAt.getTime() - run.startedAt.getTime() : null;
    const failed = args.error !== null && args.error !== undefined;
    const failurePayload = failed
      ? {
          agentInstanceId: run.agentInstanceId,
          durationMs,
          errorMessage: args.error?.message ?? "",
        }
      : null;
    const successPayload = failed
      ? null
      : {
          agentInstanceId: run.agentInstanceId,
          costCents: run.costCents,
          costInputTokens: usage?.inputTokens ?? 0,
          costOutputTokens: usage?.outputTokens ?? 0,
          durationMs,
        };
    await logActivity({
      orgId: args.activityContext.orgId,
      payload: failurePayload ?? successPayload,
      prisma: args.prisma,
      refId: args.runId,
      refType: "AGENT_RUN",
      summary: failed
        ? `Agente ${displayName} falhou: ${args.error?.message ?? ""}`
        : `Agente ${displayName} concluiu em ${durationMs ?? 0}ms`,
      type: failed ? "AGENT_RUN_FAILED" : "AGENT_RUN_FINISHED",
    });
  }

  return run;
};

// Stable hash of a subtask string so identical subtasks from the same
// parent run coalesce in the dispatcher. SHA-256 + base16 keeps it short
// enough for a Redis key without collision risk at our volume.
const hashSubtask = (subtask: string): string =>
  createHash("sha256").update(subtask, "utf8").digest("hex").slice(0, 16);

export { createAgentRun, finalizeAgentRun, hashSubtask };
export type { CreateAgentRunArgs, FinalizeAgentRunArgs, RunActivityContext };
