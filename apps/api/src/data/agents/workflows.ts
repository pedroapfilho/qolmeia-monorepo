import type { PrismaClient } from "@repo/db";
import type {
  WorkflowCompleteInput,
  WorkflowDecisionInput,
  WorkflowProposalInput,
} from "@repo/worker-api/internal";

import { decideAction, logActivity, markExecuted, proposeAction } from "./actions";
import { transitionTicketRecord } from "./tickets";

const completeWorkflow = async (db: PrismaClient, input: WorkflowCompleteInput): Promise<void> => {
  await db.$transaction(async (tx) => {
    await transitionTicketRecord(tx, {
      activity: {
        companyId: input.companyId,
        refId: input.ticketId,
        refType: "ticket",
        summary:
          input.policy === "notify_only"
            ? "Ticket concluído (notify-only): disponível para conferência."
            : "Ticket concluído automaticamente (auto-execute).",
        type: "TICKET_DONE",
      },
      result: { summary: input.summary },
      status: "done",
      ticketId: input.ticketId,
    });
    if (input.policy === "notify_only") {
      await logActivity(tx, {
        companyId: input.companyId,
        payload: { summary: input.summary },
        refId: input.ticketId,
        refType: "ticket",
        summary: "Ação executada sem bloqueio, para conferência do operador.",
        type: "ACTION_NOTIFY",
      });
    }
  });
};

const proposeWorkflow = (db: PrismaClient, input: WorkflowProposalInput): Promise<{ id: string }> =>
  db.$transaction(async (tx) => {
    const action = await proposeAction(tx, {
      actionType: input.actionType,
      companyId: input.companyId,
      policy: input.policy,
      proposed: input.proposed,
      ticketId: input.ticketId,
    });
    await transitionTicketRecord(tx, {
      activity:
        input.round > 0
          ? {
              companyId: input.companyId,
              payload: { feedback: input.feedback, revision: input.round },
              refId: action.id,
              refType: "action",
              summary: `Entrega revisada (revisão ${input.round}) aguardando decisão.`,
              type: "ACTION_REVISED",
            }
          : {
              companyId: input.companyId,
              payload: { actionId: action.id, summary: input.summary },
              refId: action.id,
              refType: "action",
              summary: "Ação proposta aguardando decisão.",
              type: "ACTION_PROPOSED",
            },
      status: "awaiting_approval",
      ticketId: input.ticketId,
    });
    return action;
  });

const decisionActivity = (input: WorkflowDecisionInput) => {
  if (input.decision === "approved") {
    return {
      actorId: input.decidedByUserId,
      companyId: input.companyId,
      refId: input.actionId,
      refType: "action",
      summary: "Ação aprovada e executada.",
      type: "ACTION_EXECUTED",
    };
  }

  if (input.decision === "rejected") {
    return {
      actorId: input.decidedByUserId,
      companyId: input.companyId,
      payload: { feedback: input.feedback ?? null },
      refId: input.actionId,
      refType: "action",
      summary: "Ação rejeitada.",
      type: "ACTION_REJECTED",
    };
  }

  return {
    actorId: input.decidedByUserId,
    companyId: input.companyId,
    payload: { feedback: input.feedback ?? null },
    refId: input.actionId,
    refType: "action",
    summary: "Alterações solicitadas.",
    type: "ACTION_CHANGES_REQUESTED",
  };
};

const decisionStatus = (decision: WorkflowDecisionInput["decision"]) => {
  if (decision === "approved") {
    return "done" as const;
  }
  if (decision === "rejected") {
    return "rejected" as const;
  }
  return "in_progress" as const;
};

const applyWorkflowDecision = async (
  db: PrismaClient,
  input: WorkflowDecisionInput,
): Promise<void> => {
  await db.$transaction(async (tx) => {
    await decideAction(tx, input);
    if (input.decision === "approved") {
      await markExecuted(tx, input.actionId);
    }
    const transition = {
      activity: decisionActivity(input),
      status: decisionStatus(input.decision),
      ticketId: input.ticketId,
    };
    if (input.decision === "approved") {
      await transitionTicketRecord(tx, { ...transition, result: { summary: input.summary } });
      return;
    }
    await transitionTicketRecord(tx, transition);
  });
};

export { applyWorkflowDecision, completeWorkflow, proposeWorkflow };
