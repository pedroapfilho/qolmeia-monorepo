import type { AgentAction, PrismaClient } from "@repo/db";

import { logActivity } from "../activity/log";
import { logger } from "../lib/logger";

import type { AgentDispatcher } from "./dispatcher";
import { findSkillById } from "./skills/registry";
import type { AnySkill, SkillContext } from "./skills/types";

// Phase 5 §8 customer-side approval transitions. These are programmatic
// interfaces — no HTTP endpoints yet (that ships with the web UI). They
// move a DRAFTED action through APPROVED → EXECUTED (or REJECTED, EDITED)
// and emit the matching ActivityLog rows.

type ApprovalsPrisma = Pick<PrismaClient, "activityLog" | "agentAction" | "agentInstance">;

type ApproveActionArgs = {
  actionId: string;
  decidedByUserId: string;
  prisma: ApprovalsPrisma;
};

const ensureDrafted = (action: AgentAction): void => {
  if (action.status !== "DRAFTED") {
    throw new Error(
      `Action ${action.id} is in status ${action.status}; only DRAFTED actions can transition.`,
    );
  }
};

// Marks the action as APPROVED. Does NOT run the skill — executeApprovedAction
// is the explicit second step so callers can batch-approve and execute later,
// and so failures during execution don't roll back the approval decision.
const approveAction = async (args: ApproveActionArgs): Promise<AgentAction> => {
  const current = await args.prisma.agentAction.findUniqueOrThrow({ where: { id: args.actionId } });
  ensureDrafted(current);

  const updated = await args.prisma.agentAction.update({
    data: {
      decidedAt: new Date(),
      decidedByUserId: args.decidedByUserId,
      status: "APPROVED",
    },
    where: { id: args.actionId },
  });

  const agentInstance = await args.prisma.agentInstance.findUniqueOrThrow({
    select: { displayName: true, orgId: true },
    where: { id: updated.agentInstanceId },
  });
  await logActivity({
    actorId: args.decidedByUserId,
    orgId: agentInstance.orgId,
    payload: {
      agentInstanceId: updated.agentInstanceId,
      decidedByUserId: args.decidedByUserId,
      skillId: updated.skillId,
    },
    prisma: args.prisma,
    refId: updated.id,
    refType: "AGENT_ACTION",
    summary: `Ação aprovada por ${args.decidedByUserId}`,
    type: "ACTION_APPROVED",
  });

  return updated;
};

type RejectActionArgs = {
  actionId: string;
  decidedByUserId: string;
  prisma: ApprovalsPrisma;
  reason?: string;
};

const rejectAction = async (args: RejectActionArgs): Promise<AgentAction> => {
  const current = await args.prisma.agentAction.findUniqueOrThrow({ where: { id: args.actionId } });
  ensureDrafted(current);

  const updated = await args.prisma.agentAction.update({
    data: {
      // Reason lives in errorMessage. It isn't a runtime error, but the field
      // is already typed as freeform text and the web UI can render it as
      // "rejection reason" once the status is REJECTED.
      decidedAt: new Date(),
      decidedByUserId: args.decidedByUserId,
      errorMessage: args.reason ?? null,
      status: "REJECTED",
    },
    where: { id: args.actionId },
  });

  const agentInstance = await args.prisma.agentInstance.findUniqueOrThrow({
    select: { orgId: true },
    where: { id: updated.agentInstanceId },
  });
  await logActivity({
    actorId: args.decidedByUserId,
    orgId: agentInstance.orgId,
    payload: {
      agentInstanceId: updated.agentInstanceId,
      decidedByUserId: args.decidedByUserId,
      reason: args.reason ?? null,
      skillId: updated.skillId,
    },
    prisma: args.prisma,
    refId: updated.id,
    refType: "AGENT_ACTION",
    summary: `Ação rejeitada por ${args.decidedByUserId}`,
    type: "ACTION_REJECTED",
  });

  return updated;
};

type EditActionArgs = {
  actionId: string;
  decidedByUserId: string;
  newInput: object;
  prisma: ApprovalsPrisma;
};

// Edited actions are still considered approved (the owner accepted them after
// tweaking the proposed input). executeApprovedAction handles EDITED the same
// as APPROVED but runs against the edited proposedInput.
const editAction = async (args: EditActionArgs): Promise<AgentAction> => {
  const current = await args.prisma.agentAction.findUniqueOrThrow({ where: { id: args.actionId } });
  ensureDrafted(current);

  const updated = await args.prisma.agentAction.update({
    data: {
      decidedAt: new Date(),
      decidedByUserId: args.decidedByUserId,
      proposedInput: args.newInput,
      status: "EDITED",
    },
    where: { id: args.actionId },
  });

  const agentInstance = await args.prisma.agentInstance.findUniqueOrThrow({
    select: { orgId: true },
    where: { id: updated.agentInstanceId },
  });
  await logActivity({
    actorId: args.decidedByUserId,
    orgId: agentInstance.orgId,
    payload: {
      agentInstanceId: updated.agentInstanceId,
      decidedByUserId: args.decidedByUserId,
      edited: true,
      skillId: updated.skillId,
    },
    prisma: args.prisma,
    refId: updated.id,
    refType: "AGENT_ACTION",
    summary: `Ação editada e aprovada por ${args.decidedByUserId}`,
    type: "ACTION_APPROVED",
  });

  return updated;
};

type ExecuteApprovedActionArgs = {
  actionId: string;
  // Injected so tests can stub a skill runner and so future versions can
  // dispatch through the BullMQ worker instead of inline. Default: look up
  // the in-code skill registry and call skill.execute directly.
  buildSkillContext?: (args: { action: AgentAction; orgId: string }) => SkillContext;
  prisma: ApprovalsPrisma;
  runSkill?: (skill: AnySkill, input: unknown, ctx: SkillContext) => Promise<unknown>;
};

// Default SkillContext builder: leaves dispatcher + parentRunArgs as undefined
// stubs because no requires-approval skill in v0 (generateBrandImage,
// draftMarketingStrategy) reaches for them. If a future approval-gated skill
// needs them, this helper will need a real dispatcher injected — that's the
// point at which we add a queued path for approved execution.
const defaultBuildSkillContext = ({
  action,
  orgId,
  prisma,
}: {
  action: AgentAction;
  orgId: string;
  prisma: PrismaClient;
}): SkillContext => ({
  agentInstanceId: action.agentInstanceId,
  dispatcher: undefined as unknown as AgentDispatcher,
  orgId,
  parentRunArgs: undefined as unknown as SkillContext["parentRunArgs"],
  parentRunId: action.runId ?? action.id,
  prisma,
});

const executeApprovedAction = async (args: ExecuteApprovedActionArgs): Promise<AgentAction> => {
  const action = await args.prisma.agentAction.findUniqueOrThrow({ where: { id: args.actionId } });
  if (action.status !== "APPROVED" && action.status !== "EDITED") {
    throw new Error(
      `Action ${action.id} is in status ${action.status}; only APPROVED/EDITED actions can be executed.`,
    );
  }

  const skill = findSkillById(action.skillId);
  if (!skill) {
    throw new Error(`Action ${action.id} references unknown skill ${action.skillId}`);
  }

  const agentInstance = await args.prisma.agentInstance.findUniqueOrThrow({
    select: { displayName: true, orgId: true },
    where: { id: action.agentInstanceId },
  });

  const ctx =
    args.buildSkillContext?.({ action, orgId: agentInstance.orgId }) ??
    defaultBuildSkillContext({
      action,
      orgId: agentInstance.orgId,
      prisma: args.prisma as PrismaClient,
    });

  const runner =
    args.runSkill ??
    ((s: AnySkill, input: unknown, c: SkillContext) => s.execute(input, c) as Promise<unknown>);

  try {
    const result = await runner(skill, action.proposedInput, ctx);
    const executed = await args.prisma.agentAction.update({
      data: {
        executedAt: new Date(),
        resultJson: (result as object | null | undefined) ?? undefined,
        status: "EXECUTED",
      },
      where: { id: action.id },
    });
    await logActivity({
      orgId: agentInstance.orgId,
      payload: {
        agentInstanceId: action.agentInstanceId,
        output: (result as object | null | undefined) ?? null,
        skillId: action.skillId,
      },
      prisma: args.prisma,
      refId: executed.id,
      refType: "AGENT_ACTION",
      summary: `Skill ${skill.displayName} executada (pós-aprovação)`,
      type: "ACTION_EXECUTED",
    });
    return executed;
  } catch (error) {
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.error(
      { actionId: action.id, error: errorMessage, skillId: action.skillId },
      "executeApprovedAction.failed",
    );
    const failed = await args.prisma.agentAction.update({
      data: {
        errorMessage,
        executedAt: new Date(),
        status: "FAILED",
      },
      where: { id: action.id },
    });
    await logActivity({
      orgId: agentInstance.orgId,
      payload: {
        agentInstanceId: action.agentInstanceId,
        errorMessage,
        skillId: action.skillId,
      },
      prisma: args.prisma,
      refId: failed.id,
      refType: "AGENT_ACTION",
      summary: `Skill ${skill.displayName} falhou na execução pós-aprovação`,
      type: "ACTION_FAILED",
    });
    return failed;
  }
};

export { approveAction, editAction, executeApprovedAction, rejectAction };
export type { ApproveActionArgs, EditActionArgs, ExecuteApprovedActionArgs, RejectActionArgs };
