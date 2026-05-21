import type { AgentAction, AgentActionStatus, PrismaClient } from "@repo/db";

import { findSkillById } from "./skills/registry";

type CreateActionArgs = {
  agentInstanceId: string;
  costCents?: number;
  costInputTokens?: number;
  costOutputTokens?: number;
  errorMessage?: string;
  parentActionId?: string;
  prisma: Pick<PrismaClient, "agentAction">;
  proposedInput: object;
  proposedSummary: string;
  resultJson?: object | null;
  // Parent AgentRun id. Optional during the transition window; new callers
  // always pass it so AgentAction rows link back to their run.
  runId?: string;
  skillId: string;
  triggerMessageId?: string;
};

// v0 approval rule: every action AUTO_APPROVES because the only connector
// today is OWNER-side (Pedro's Telegram). Phase 5h introduces CUSTOMER
// connectors and the rule becomes:
//   status = (ownerSide || !skill.requiresApprovalDefault)
//              ? AUTO_APPROVED : DRAFTED
// For now the rule is collapsed; the connector senderRole isn't wired
// into the runtime yet.
const resolveActionStatus = (skillId: string, success: boolean): AgentActionStatus => {
  if (!success) {
    return "FAILED";
  }
  const skill = findSkillById(skillId);
  // Defensive: if a skill isn't in the registry, treat as auto-approved.
  if (!skill) {
    return "AUTO_APPROVED";
  }
  // v0: collapse to AUTO_APPROVED. Future per-connector senderRole gate
  // lives in this function (when CUSTOMER connectors exist).
  return "AUTO_APPROVED";
};

const recordAgentAction = (args: CreateActionArgs): Promise<AgentAction> => {
  const success = args.errorMessage === undefined && args.errorMessage !== null;
  const status = resolveActionStatus(args.skillId, success);

  return args.prisma.agentAction.create({
    data: {
      agentInstanceId: args.agentInstanceId,
      costCents: args.costCents ?? 0,
      costInputTokens: args.costInputTokens ?? 0,
      costOutputTokens: args.costOutputTokens ?? 0,
      errorMessage: args.errorMessage ?? null,
      executedAt: status === "AUTO_APPROVED" ? new Date() : null,
      parentActionId: args.parentActionId ?? null, // TODO Phase 5h
      proposedInput: args.proposedInput,
      proposedSummary: args.proposedSummary,
      resultJson: args.resultJson ?? undefined,
      runId: args.runId ?? null,
      skillId: args.skillId,
      status,
      triggerMessageId: args.triggerMessageId ?? null, // TODO Phase 5h
    },
  });
};

export { recordAgentAction, resolveActionStatus };
export type { CreateActionArgs };
