import { dispatch } from "@flue/runtime";
import type { DecisionOutcome } from "@repo/worker-api/contracts";

import { logActivity } from "#/activity/log";
import { CorrespondentV2 } from "#/agents/correspondent";
import { getDb } from "#/db/client";
import { resolvePolicy } from "#/db/policy";
import { getCompany } from "#/db/schema";
import { loadInstanceWithTemplate } from "#/db/ticket";
import { logError, logInfo } from "#/lib/logger";
import { toRecord } from "#/lib/records";
import { emitTeamEvent } from "#/team/events";

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
    await dispatch(CorrespondentV2, {
      id: companyId,
      message: {
        body: `Um especialista do Time concluiu uma tarefa. Apresente este material ao cliente, em pt-BR, de forma calorosa e direta; mantenha as imagens em markdown e não altere o conteúdo:\n\n${result}`,
        kind: "signal",
        type: "worker.deliverable_ready",
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
  const [{ template }, company] = await Promise.all([
    loadInstanceWithTemplate(db, agentInstanceId),
    getCompany(db, companyId),
  ]);
  if (!company) {
    throw new Error("company vanished mid-workflow");
  }
  const actionType = template.defaultActionType;
  const policy = resolvePolicy(actionType, template);

  if (policy === "auto_execute" || policy === "notify_only") {
    await db("workflows.complete", {
      companyId,
      policy,
      summary: current.summary,
      ticketId,
    });
    await emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" });
    await presentToCustomer(ctx, current.summary);
    return { actionId: null, policy };
  }

  const skillResults = toRecord(JSON.parse(current.skillResultsJson));
  const draft = skillResults.draftSocialPost;
  const proposedPayload: Record<string, unknown> = { summary: current.summary, ticketId };
  if (actionType === "publish_post" && draft !== undefined) {
    proposedPayload.draft = draft;
  }
  const { id: actionId } = await db("workflows.propose", {
    actionType,
    companyId,
    feedback,
    policy,
    proposed: proposedPayload,
    round,
    summary: current.summary,
    ticketId,
  });
  await emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" });

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
  await db("workflows.applyDecision", {
    actionId,
    companyId,
    decidedByUserId,
    decision,
    feedback,
    summary: current.summary,
    ticketId,
  });
  await emitTeamEvent(env, { companyId, reason: "ticket_changed", type: "team:status" });
  if (decision === "approved") {
    await presentToCustomer(ctx, current.summary);
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
