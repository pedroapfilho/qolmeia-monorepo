import { dispatch } from "@flue/runtime";

import { logActivity } from "#/activity/log";
import { decideAction, markExecuted, proposeAction } from "#/db/action";
import type { DecisionOutcome } from "#/db/action";
import { getDb } from "#/db/client";
import { resolvePolicy } from "#/db/policy";
import { getCompany } from "#/db/schema";
import { getTemplate } from "#/db/template";
import { loadAgentInstance, markTicketDone, setTicketStatus } from "#/db/ticket";
import { logError, logInfo } from "#/lib/logger";
import { emitTeamEvent } from "#/team/events";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const MAX_REVISIONS = 3;

type JobContext = {
  agentInstanceId: string;
  companyId: string;
  env: Env;
  ticketId: string;
};

type GenerateResult = {
  skillResultsJson: string;
  summary: string;
};

type ProposeResult = { actionId: string | null; policy: string };

type DecisionEvent = {
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

const presentToCustomer = async (ctx: JobContext, result: string): Promise<void> => {
  const { companyId, ticketId } = ctx;
  try {
    await dispatch({
      agent: "correspondent",
      id: companyId,
      input: {
        message: `Um especialista do Time concluiu uma tarefa. Apresente este material ao cliente, em pt-BR, de forma calorosa e direta — mantenha as imagens em markdown e não altere o conteúdo:\n\n${result}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError("workflow.presentResult.err", { companyId, error: message, ticketId });
  }
};

const proposeDeliverable = async (
  ctx: JobContext,
  round: number,
  feedback: string | null,
  current: GenerateResult,
): Promise<ProposeResult> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
  const db = getDb(env);
  const agentInstance = await loadAgentInstance(db, agentInstanceId);
  if (
    agentInstance === null ||
    agentInstance.templateId === null ||
    agentInstance.templateId === ""
  ) {
    throw new Error("agent_instance vanished mid-workflow");
  }
  const [template, company] = await Promise.all([
    getTemplate(db, agentInstance.templateId),
    getCompany(db, companyId),
  ]);
  if (!template || !company) {
    throw new Error("template or company vanished mid-workflow");
  }
  const actionType = template.defaultActionType;
  const policy = resolvePolicy(actionType, template);

  if (policy === "auto-execute" || policy === "notify-only") {
    await Promise.all([
      markTicketDone(db, ticketId, { summary: current.summary }),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(db, {
        companyId,
        refId: ticketId,
        refType: "ticket",
        summary:
          policy === "notify-only"
            ? "Ticket concluído (notify-only): disponível para conferência."
            : "Ticket concluído automaticamente (auto-execute).",
        type: "TICKET_DONE",
      }),
    ]);
    if (policy === "notify-only") {
      await logActivity(db, {
        companyId,
        payload: { summary: current.summary },
        refId: ticketId,
        refType: "ticket",
        summary: "Ação executada sem bloqueio, para conferência do operador.",
        type: "ACTION_NOTIFY",
      });
    }
    await presentToCustomer(ctx, current.summary);
    return { actionId: null, policy };
  }

  const parsedSkillResults: unknown = JSON.parse(current.skillResultsJson);
  const skillResults = isRecord(parsedSkillResults) ? parsedSkillResults : {};
  const draft = skillResults.draftSocialPost;
  const proposedPayload: Record<string, unknown> = { summary: current.summary, ticketId };
  if (actionType === "publish_post" && draft !== undefined) {
    proposedPayload.draft = draft;
  }
  const { id: actionId } = await proposeAction(db, {
    actionType,
    companyId,
    policy,
    proposed: proposedPayload,
    ticketId,
  });
  await Promise.all([
    setTicketStatus(db, ticketId, "awaiting_approval"),
    emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
    logActivity(
      db,
      round > 0
        ? {
            companyId,
            payload: { feedback, revision: round },
            refId: actionId,
            refType: "action",
            summary: `Entrega revisada (revisão ${round}) aguardando decisão.`,
            type: "ACTION_REVISED",
          }
        : {
            companyId,
            payload: { actionId, summary: current.summary },
            refId: actionId,
            refType: "action",
            summary: "Ação proposta aguardando decisão.",
            type: "ACTION_PROPOSED",
          },
    ),
  ]);

  logInfo("workflow.propose.ok", { actionId, agentInstanceId, companyId, policy, ticketId });
  return { actionId, policy };
};

const applyDecision = async (
  ctx: JobContext,
  actionId: string,
  current: GenerateResult,
  event: DecisionEvent,
): Promise<DecisionOutcome> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
  const db = getDb(env);
  const { decidedByUserId, decision, feedback } = event;
  logInfo("workflow.decision.received", {
    actionId,
    agentInstanceId,
    companyId,
    decidedByUserId,
    decision,
    feedback: feedback ?? null,
    ticketId,
  });
  await decideAction(db, { actionId, decidedByUserId, decision, feedback });
  if (decision === "approved") {
    await Promise.all([
      markExecuted(db, actionId),
      markTicketDone(db, ticketId, { summary: current.summary }),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(db, {
        actorId: decidedByUserId,
        companyId,
        refId: actionId,
        refType: "action",
        summary: "Ação aprovada e executada.",
        type: "ACTION_EXECUTED",
      }),
    ]);
    await presentToCustomer(ctx, current.summary);
  } else if (decision === "rejected") {
    await Promise.all([
      setTicketStatus(db, ticketId, "rejected"),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(db, {
        actorId: decidedByUserId,
        companyId,
        payload: { feedback: feedback ?? null },
        refId: actionId,
        refType: "action",
        summary: "Ação rejeitada.",
        type: "ACTION_REJECTED",
      }),
    ]);
  } else {
    await Promise.all([
      setTicketStatus(db, ticketId, "in_progress"),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(db, {
        actorId: decidedByUserId,
        companyId,
        payload: { feedback: feedback ?? null },
        refId: actionId,
        refType: "action",
        summary: "Alterações solicitadas.",
        type: "ACTION_CHANGES_REQUESTED",
      }),
    ]);
  }
  return decision;
};

const logRevisionCapped = async (ctx: JobContext, actionId: string): Promise<void> => {
  await logActivity(getDb(ctx.env), {
    companyId: ctx.companyId,
    payload: { revisions: MAX_REVISIONS },
    refId: actionId,
    refType: "action",
    summary: `Limite de ${MAX_REVISIONS} revisões atingido: o agente não vai refazer de novo. Aprove ou rejeite a última versão.`,
    type: "ACTION_REVISION_CAPPED",
  });
};

export { applyDecision, logRevisionCapped, MAX_REVISIONS, proposeDeliverable };
export type { DecisionEvent, GenerateResult, JobContext, ProposeResult };
