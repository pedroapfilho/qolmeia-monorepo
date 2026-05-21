import type { AgentAction, AgentActionStatus, PrismaClient, SenderRole } from "@repo/db";

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
  // senderRole of the ConnectorInstance that triggered this run. Null means
  // the action originated from an internal trigger (no connector — e.g. a
  // scheduled job or a delegation root) and is treated as owner-side.
  // Phase 5 §8 approval rule:
  //   ownerSide = senderRole !== "CUSTOMER"
  //   status   = (ownerSide || !skill.requiresApprovalDefault) ? AUTO_APPROVED : DRAFTED
  senderRole?: SenderRole | null;
  skillId: string;
  triggerMessageId?: string;
};

type ResolveActionStatusArgs = {
  senderRole: SenderRole | null;
  skillRequiresApprovalDefault: boolean;
};

// Phase 5 §8 rule. Pure: no DB, no I/O.
//   - Owner-side (senderRole == OWNER, or null meaning "no connector") always
//     auto-approves — Pedro and internal actions don't need a gate.
//   - Customer-side runs auto-approve only when the skill itself opts in to
//     skipping approval (read-only / internal skills with
//     requiresApprovalDefault=false). Otherwise the action is DRAFTED for the
//     owner to approve.
const resolveActionStatus = (args: ResolveActionStatusArgs): "AUTO_APPROVED" | "DRAFTED" => {
  const ownerSide = args.senderRole !== "CUSTOMER";
  if (ownerSide) {
    return "AUTO_APPROVED";
  }
  return args.skillRequiresApprovalDefault ? "DRAFTED" : "AUTO_APPROVED";
};

// Wraps resolveActionStatus and folds in the failure case. The runtime calls
// this with the skill id (already validated against the registry) plus the
// run's senderRole; we look up requiresApprovalDefault here so callers don't
// need the Skill object.
const computeActionStatus = (args: {
  senderRole: SenderRole | null;
  skillId: string;
  success: boolean;
}): AgentActionStatus => {
  if (!args.success) {
    return "FAILED";
  }
  const skill = findSkillById(args.skillId);
  // Defensive: unknown skills auto-approve. This branch is unreachable in
  // normal flow because the runtime only invokes registered skills.
  const requires = skill?.requiresApprovalDefault ?? false;
  return resolveActionStatus({
    senderRole: args.senderRole,
    skillRequiresApprovalDefault: requires,
  });
};

const recordAgentAction = (args: CreateActionArgs): Promise<AgentAction> => {
  const success = args.errorMessage === undefined || args.errorMessage === null;
  const status = computeActionStatus({
    senderRole: args.senderRole ?? null,
    skillId: args.skillId,
    success,
  });

  return args.prisma.agentAction.create({
    data: {
      agentInstanceId: args.agentInstanceId,
      costCents: args.costCents ?? 0,
      costInputTokens: args.costInputTokens ?? 0,
      costOutputTokens: args.costOutputTokens ?? 0,
      errorMessage: args.errorMessage ?? null,
      // AUTO_APPROVED = ran and committed; DRAFTED waits for approval;
      // FAILED already ran. Only AUTO_APPROVED + FAILED rows get an
      // executedAt at create time. APPROVED/EDITED rows get their
      // executedAt stamped by executeApprovedAction (Group 3.5).
      executedAt: status === "AUTO_APPROVED" ? new Date() : null,
      parentActionId: args.parentActionId ?? null,
      proposedInput: args.proposedInput,
      proposedSummary: args.proposedSummary,
      resultJson: args.resultJson ?? undefined,
      runId: args.runId ?? null,
      skillId: args.skillId,
      status,
      triggerMessageId: args.triggerMessageId ?? null,
    },
  });
};

export { computeActionStatus, recordAgentAction, resolveActionStatus };
export type { CreateActionArgs, ResolveActionStatusArgs };
