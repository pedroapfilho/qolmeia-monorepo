import { createHash } from "node:crypto";

import type { AgentRun, PrismaClient } from "@repo/db";

import type { ContextSnapshot } from "./context-snapshot";
import type { AgentRunResult } from "./dispatcher";

type CreateAgentRunArgs = {
  agentInstanceId: string;
  contextSnapshot: ContextSnapshot;
  parentRunId?: string | null;
  prisma: Pick<PrismaClient, "agentRun">;
  systemPrompt: string;
  triggerMessageId?: string | null;
};

const createAgentRun = (args: CreateAgentRunArgs): Promise<AgentRun> =>
  args.prisma.agentRun.create({
    data: {
      agentInstanceId: args.agentInstanceId,
      contextSnapshot: args.contextSnapshot as unknown as object,
      parentRunId: args.parentRunId ?? null,
      systemPrompt: args.systemPrompt,
      triggerMessageId: args.triggerMessageId ?? null,
    },
  });

type FinalizeAgentRunArgs = {
  error?: Error | null;
  prisma: Pick<PrismaClient, "agentRun">;
  result?: AgentRunResult | null;
  runId: string;
};

const finalizeAgentRun = (args: FinalizeAgentRunArgs): Promise<AgentRun> => {
  const usage = args.result?.usage;
  return args.prisma.agentRun.update({
    data: {
      costInputTokens: usage?.inputTokens ?? 0,
      costOutputTokens: usage?.outputTokens ?? 0,
      errorMessage: args.error ? args.error.message : null,
      finishedAt: new Date(),
      status: args.error ? "FAILED" : "SUCCEEDED",
    },
    where: { id: args.runId },
  });
};

// Stable hash of a subtask string so identical subtasks from the same
// parent run coalesce in the dispatcher. SHA-256 + base16 keeps it short
// enough for a Redis key without collision risk at our volume.
const hashSubtask = (subtask: string): string =>
  createHash("sha256").update(subtask, "utf8").digest("hex").slice(0, 16);

export { createAgentRun, finalizeAgentRun, hashSubtask };
export type { CreateAgentRunArgs, FinalizeAgentRunArgs };
