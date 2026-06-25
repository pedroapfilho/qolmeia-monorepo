import { dispatch } from "@flue/runtime";

import { logActivity } from "#/activity/log";
import { decideAction, markExecuted, proposeAction } from "#/db/action";
import type { DecisionOutcome } from "#/db/action";
import { resolvePolicy } from "#/db/policy";
import { getCompany } from "#/db/schema";
import { getTemplate } from "#/db/template";
import { loadAgentInstance, markTicketDone, setTicketStatus } from "#/db/ticket";
import { logError, logInfo } from "#/lib/logger";
import { emitTeamEvent } from "#/team/events";

// The approval-gate steps of a Worker job: propose and decide, plus the shared
// job-step contracts. Orchestration lives in worker-job.ts, generation in
// worker-job-generate.ts. Steps take a JobContext (the job's stable identity +
// env); per-round state is passed in so each function stays loop-agnostic.

// Max reworks from operator feedback before the loop stops regenerating. The
// deliverable stays open for approve/reject past the cap.
const MAX_REVISIONS = 3;

type JobContext = {
  agentInstanceId: string;
  companyId: string;
  env: Env;
  ticketId: string;
};

type GenerateResult = {
  // Tool-call outputs from generation, keyed by skill id, for the propose step
  // to attach to the action payload (e.g. publish_post reads draftSocialPost).
  // Last write wins per skill id; Workers should call each skill at most once.
  //
  // JSON-stringified because Cloudflare Workflows' Serializable check on the
  // step.do boundary rejects `unknown`, and a recursive JsonValue alias crashes
  // tsc with "instantiation excessively deep".
  skillResultsJson: string;
  summary: string;
};

type ProposeResult = { actionId: string | null; policy: string };

type DecisionEvent = {
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

// Show a finished deliverable in the customer's chat via the Correspondent.
// Best-effort: a failure here must never fail the job.
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

// `propose-<round>` step: resolve the action policy and either run the
// deliverable immediately (auto-execute / notify-only) or open an approval
// gate. Returns the actionId to wait on, or null when no gate is needed.
const proposeDeliverable = async (
  ctx: JobContext,
  round: number,
  feedback: string | null,
  current: GenerateResult,
): Promise<ProposeResult> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
  const agentInstance = await loadAgentInstance(env.DB, agentInstanceId);
  if (!agentInstance?.templateId) {
    throw new Error("agent_instance vanished mid-workflow");
  }
  // Independent D1 reads, overlapped.
  const [template, company] = await Promise.all([
    getTemplate(env.DB, agentInstance.templateId),
    getCompany(env.DB, companyId),
  ]);
  if (!template || !company) {
    throw new Error("template or company vanished mid-workflow");
  }
  const actionType = template.defaultActionType;
  const policy = resolvePolicy(actionType, template);

  // auto-execute and notify-only both run immediately (no gate). notify-only
  // additionally logs to the operator feed for an after-the-fact check (ADR 0006).
  if (policy === "auto-execute" || policy === "notify-only") {
    await Promise.all([
      markTicketDone(env.DB, ticketId, { summary: current.summary }),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(env, {
        companyId,
        refId: ticketId,
        refType: "ticket",
        summary:
          policy === "notify-only"
            ? "Ticket concluído (notify-only) — disponível para conferência."
            : "Ticket concluído automaticamente (auto-execute).",
        type: "TICKET_DONE",
      }),
    ]);
    if (policy === "notify-only") {
      await logActivity(env, {
        companyId,
        payload: { summary: current.summary },
        refId: ticketId,
        refType: "ticket",
        summary: "Ação executada sem bloqueio — para conferência do operador.",
        type: "ACTION_NOTIFY",
      });
    }
    // Ungated work still has a deliverable to show, or the chat stays silent
    // after the Correspondent said it would ask the specialist.
    await presentToCustomer(ctx, current.summary);
    return { actionId: null, policy };
  }

  // Action-type-specific payload: publish_post carries the draftSocialPost
  // result for the backoffice renderer; other types fall back to the summary.
  // A new structured renderer is one branch here plus one in components/action-renderers/.
  const skillResults = JSON.parse(current.skillResultsJson) as Record<string, unknown>;
  const draft = skillResults.draftSocialPost;
  const proposedPayload: Record<string, unknown> = { summary: current.summary, ticketId };
  if (actionType === "publish_post" && draft !== undefined) {
    proposedPayload.draft = draft;
  }
  const { id: actionId } = await proposeAction(env.DB, {
    actionType,
    companyId,
    policy,
    proposed: proposedPayload,
    ticketId,
  });
  // Round 0 is a fresh proposal; later rounds are revisions. Once the action
  // exists, the status/event/log writes are independent.
  await Promise.all([
    setTicketStatus(env.DB, ticketId, "awaiting_approval"),
    emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
    logActivity(
      env,
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

  // No customer notification at proposal time: the operator approves on
  // /approvals, and the customer sees the deliverable only once it's executed.

  logInfo("workflow.propose.ok", { actionId, agentInstanceId, companyId, policy, ticketId });
  return { actionId, policy };
};

// `decide-<round>` step: record the operator's decision and apply its terminal
// or rework side-effects. approved → execute + present; rejected → close;
// request-changes → reopen for the next revise round.
const applyDecision = async (
  ctx: JobContext,
  actionId: string,
  current: GenerateResult,
  event: DecisionEvent,
): Promise<DecisionOutcome> => {
  const { agentInstanceId, companyId, env, ticketId } = ctx;
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
  await decideAction(env.DB, { actionId, decidedByUserId, decision, feedback });
  if (decision === "approved") {
    await Promise.all([
      markExecuted(env.DB, actionId),
      markTicketDone(env.DB, ticketId, { summary: current.summary }),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(env, {
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
      setTicketStatus(env.DB, ticketId, "rejected"),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(env, {
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
    // request-changes: the Worker will rework (the loop regenerates with this
    // feedback). Back to in_progress while it does.
    await Promise.all([
      setTicketStatus(env.DB, ticketId, "in_progress"),
      emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" }),
      logActivity(env, {
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

// `revise-capped` step: tell the operator once that the Worker won't rework
// past the cap, so they approve or reject the last version.
const logRevisionCapped = async (ctx: JobContext, actionId: string): Promise<void> => {
  await logActivity(ctx.env, {
    companyId: ctx.companyId,
    payload: { revisions: MAX_REVISIONS },
    refId: actionId,
    refType: "action",
    summary: `Limite de ${MAX_REVISIONS} revisões atingido — o agente não vai refazer de novo. Aprove ou rejeite a última versão.`,
    type: "ACTION_REVISION_CAPPED",
  });
};

export { applyDecision, logRevisionCapped, MAX_REVISIONS, proposeDeliverable };
export type { DecisionEvent, GenerateResult, JobContext, ProposeResult };
