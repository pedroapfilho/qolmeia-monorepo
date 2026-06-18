import { getAgentByName } from "agents";
import { generateText, stepCountIs } from "ai";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { logActivity } from "@/activity/log";
import { decideAction, markExecuted, proposeAction } from "@/db/action";
import type { DecisionOutcome } from "@/db/action";
import { resolvePolicy } from "@/db/policy";
import { getCompany } from "@/db/schema";
import { getTemplate } from "@/db/template";
import { loadAgentInstance, loadTicket, markTicketDone, setTicketStatus } from "@/db/ticket";
import { getModel } from "@/lib/ai-gateway";
import { logError, logInfo } from "@/lib/logger";
import { buildSkillTools } from "@/skills/registry";
import { emitTeamEvent } from "@/team/events";
import { resolveSystemPrompt } from "@/team/resolve-system-prompt";

// One generic Workflow class for every Worker job (decision 1 in the P4 plan).
// The Workflow is the *task's* lifecycle; the Worker DO is the agent's
// *identity*. step.do checkpoints survive eviction; step.waitForEvent pauses
// until the User decides, at zero cost.
//
// The job is a loop (ADR 0006): generate → propose → wait for the operator's
// decision. approve/reject are terminal; request-changes feeds the operator's
// note back to the Worker, which regenerates and re-proposes. A soft cap bounds
// regeneration — past it the Worker stops reworking and the operator simply
// approves or rejects the last version.

// Max times the Worker will rework from operator feedback before the loop
// stops regenerating (the deliverable still stays open for approve/reject).
const MAX_REVISIONS = 3;

type WorkerJobParams = {
  agentInstanceId: string;
  companyId: string;
  ticketId: string;
};

type GenerateResult = {
  // Tool-call outputs the Worker produced during generation, keyed by skill
  // id. The Workflow attaches these to the proposed action payload so per-
  // action-type renderers in the backoffice can show structured fields
  // (e.g. publish_post → draftSocialPost result with platform/body/CTA).
  // Last-write-wins on duplicate skill ids — Workers should call each
  // skill at most once per ticket anyway.
  //
  // Typed as `string` blobs (JSON-stringified) for the step.do boundary —
  // Cloudflare Workflows' Serializable check rejects `unknown` even though
  // the runtime values are JSON-safe. Stringifying at the boundary makes
  // the type contract honest without a recursive JsonValue alias (which
  // crashes the compiler with "instantiation excessively deep").
  skillResultsJson: string;
  summary: string;
};

type ProposeResult = { actionId: string | null; policy: string };

type DecisionEvent = {
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

type ChatMessage = { content: string; role: "assistant" | "user" };

// The prompt for one generation round. The first round is just the brief; a
// revision round replays the prior deliverable and the operator's note so the
// Worker reworks instead of starting over.
const buildRevisionMessages = (
  brief: string,
  priorSummary: string | null,
  feedback: string | null,
): Array<ChatMessage> => {
  const messages: Array<ChatMessage> = [{ content: brief, role: "user" }];
  if (priorSummary && feedback) {
    messages.push({ content: priorSummary, role: "assistant" });
    messages.push({
      content: `O revisor (operador da Qolmeia) pediu ajustes na entrega anterior:\n\n"${feedback}"\n\nRefaça o trabalho incorporando o pedido. Mantenha o que já estava bom e entregue a versão revisada.`,
      role: "user",
    });
  }
  return messages;
};

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  // Capture is curated, not blanket (ADR 0007): a Worker decides what's worth
  // keeping by calling `saveAsset` (customer deliverable vs agent working file)
  // or `rememberFact` during generation. The old blanket dump that turned every
  // text reply into a `knowledge_doc` is gone — the chat already shows the
  // summary, and an undifferentiated doc pile helped no one.

  // Surface a finished deliverable in the customer's chat via the Correspondent
  // DO. Best-effort: a presentation failure must never fail the job.
  private async presentToCustomer(
    companyId: string,
    ticketId: string,
    result: string,
  ): Promise<void> {
    try {
      const corr = await getAgentByName(this.env.CORRESPONDENT, companyId);
      await corr.presentResult({ result, ticketId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("workflow.presentResult.err", { companyId, error: message, ticketId });
    }
  }

  // Cloudflare Workflows entrypoint — the runtime invokes run().
  // fallow-ignore-next-line unused-class-member
  async run(event: Readonly<WorkflowEvent<WorkerJobParams>>, step: WorkflowStep): Promise<unknown> {
    const { agentInstanceId, companyId, ticketId } = event.payload;
    const workflowStart = Date.now();

    logInfo("workflow.start", { agentInstanceId, companyId, ticketId });

    let revision = 0;
    let priorSummary: string | null = null;
    let latestFeedback: string | null = null;
    let generated: GenerateResult | null = null;

    // Workflow steps are durable checkpoints that must run in order — each
    // await is a resume point, so they're deliberately sequential, not
    // Promise.all-able. The revise loop iterates one operator decision at a time.
    /* oxlint-disable no-await-in-loop */
    for (;;) {
      const round = revision;
      const priorForRound = priorSummary;
      const feedbackForRound = latestFeedback;

      // Past the cap, reuse the last deliverable instead of regenerating — the
      // operator can still approve/reject, but the Worker stops reworking.
      if (generated === null || round <= MAX_REVISIONS) {
        generated = await step.do(`generate-${round}`, async (): Promise<GenerateResult> => {
          const stepStart = Date.now();
          // Independent D1 reads — each await is a full round trip on Workers,
          // so fetch them in parallel (both are required: fail-fast is correct).
          const [ticket, agentInstance] = await Promise.all([
            loadTicket(this.env.DB, ticketId),
            loadAgentInstance(this.env.DB, agentInstanceId),
          ]);
          if (!ticket || !agentInstance?.templateId) {
            throw new Error(`ticket ${ticketId} or its agent_instance not properly seeded`);
          }
          const template = await getTemplate(this.env.DB, agentInstance.templateId);
          if (!template) {
            throw new Error(`template ${agentInstance.templateId} not found`);
          }
          logInfo("workflow.generate.start", {
            agentInstanceId,
            brief: ticket.brief,
            companyId,
            model: template.model,
            revision: round,
            skillIds: template.skillIds,
            templateId: template.id,
            ticketId,
          });
          const tools = await buildSkillTools(
            { agentInstanceId: agentInstance.id, companyId, env: this.env },
            template.skillIds,
          );
          const result = await generateText({
            messages: buildRevisionMessages(ticket.brief, priorForRound, feedbackForRound),
            model: getModel(this.env, template.model),
            stopWhen: stepCountIs(5),
            system: resolveSystemPrompt(agentInstance, template),
            tools,
          });
          const summary = result.text.trim();
          // Collect tool-call outputs so the propose-deliverable step can
          // attach structured fields to the action payload. The AI SDK exposes
          // tool results on `step.toolResults[i].result` (last-write-wins per
          // skill id — Workers should call each skill at most once per ticket).
          const skillResults: Record<string, unknown> = {};
          for (const stepResult of result.steps ?? []) {
            for (const toolResult of stepResult.toolResults ?? []) {
              const name = (toolResult as { toolName?: string }).toolName;
              const output =
                (toolResult as { output?: unknown }).output ??
                (toolResult as { result?: unknown }).result;
              if (typeof name === "string" && output !== undefined) {
                skillResults[name] = output;
              }
            }
          }
          logInfo("workflow.generate.ok", {
            agentInstanceId,
            companyId,
            durationMs: Date.now() - stepStart,
            replyText: summary,
            revision: round,
            skillResultNames: Object.keys(skillResults),
            ticketId,
            toolCallNames: (result.steps ?? []).flatMap((s) =>
              (s.toolCalls ?? []).map((tc) => tc.toolName),
            ),
            usage: result.usage,
          });
          return { skillResultsJson: JSON.stringify(skillResults), summary };
        });
      }

      if (!generated) {
        throw new Error("worker-job: deliverable missing after generate step");
      }
      const current = generated;

      const proposed = await step.do(`propose-${round}`, async (): Promise<ProposeResult> => {
        const agentInstance = await loadAgentInstance(this.env.DB, agentInstanceId);
        if (!agentInstance?.templateId) {
          throw new Error("agent_instance vanished mid-workflow");
        }
        // template needs agentInstance.templateId; company does not — overlap
        // the two D1 round trips.
        const [template, company] = await Promise.all([
          getTemplate(this.env.DB, agentInstance.templateId),
          getCompany(this.env.DB, companyId),
        ]);
        if (!template || !company) {
          throw new Error("template or company vanished mid-workflow");
        }
        const actionType = template.defaultActionType;
        const policy = resolvePolicy(actionType, template);

        // auto-execute and notify-only both run immediately (no gate). The
        // difference is the audit trail: notify-only is surfaced to the
        // operator monitoring feed for an after-the-fact spot-check (ADR 0006).
        if (policy === "auto-execute" || policy === "notify-only") {
          await markTicketDone(this.env.DB, ticketId, { summary: current.summary });
          await emitTeamEvent(this.env, {
            companyId,
            reason: "ticket_changed",
            type: "team:status",
          });
          await logActivity(this.env, {
            companyId,
            refId: ticketId,
            refType: "ticket",
            summary:
              policy === "notify-only"
                ? "Ticket concluído (notify-only) — disponível para conferência."
                : "Ticket concluído automaticamente (auto-execute).",
            type: "TICKET_DONE",
          });
          if (policy === "notify-only") {
            await logActivity(this.env, {
              companyId,
              payload: { summary: current.summary },
              refId: ticketId,
              refType: "ticket",
              summary: "Ação executada sem bloqueio — para conferência do operador.",
              type: "ACTION_NOTIFY",
            });
          }
          // Surface the deliverable in the customer's chat. Work that runs
          // without an operator gate still has a deliverable; without this the
          // chat goes silent after "vou pedir ao designer".
          await this.presentToCustomer(companyId, ticketId, current.summary);
          return { actionId: null, policy };
        }

        // Action-type-specific structured payload. publish_post pulls the
        // draftSocialPost tool result so the backoffice renderer can show
        // platform/body/CTA/hashtags. Other action types fall back to the
        // text summary; adding a new structured renderer is one branch here
        // plus a backoffice renderer in `components/action-renderers/`.
        const skillResults = JSON.parse(current.skillResultsJson) as Record<string, unknown>;
        const draft = skillResults.draftSocialPost;
        const proposedPayload: Record<string, unknown> = {
          summary: current.summary,
          ticketId,
        };
        if (actionType === "publish_post" && draft !== undefined) {
          proposedPayload.draft = draft;
        }
        const { id: actionId } = await proposeAction(this.env.DB, {
          actionType,
          companyId,
          policy,
          proposed: proposedPayload,
          ticketId,
        });
        await setTicketStatus(this.env.DB, ticketId, "awaiting_approval");
        await emitTeamEvent(this.env, {
          companyId,
          reason: "ticket_changed",
          type: "team:status",
        });
        // First round is a fresh proposal; later rounds are revisions prompted
        // by the operator's request-changes note.
        await logActivity(
          this.env,
          round > 0
            ? {
                companyId,
                payload: { feedback: feedbackForRound, revision: round },
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
        );

        // No customer-facing notification at proposal time: the operator is the
        // sole approver and reviews on /approvals. The customer only sees the
        // final deliverable once the action transitions to executed.

        logInfo("workflow.propose.ok", { actionId, agentInstanceId, companyId, policy, ticketId });
        return { actionId, policy };
      });

      if (!proposed.actionId) {
        logInfo("workflow.done.nogate", {
          agentInstanceId,
          companyId,
          durationMs: Date.now() - workflowStart,
          policy: proposed.policy,
          ticketId,
        });
        return { ok: true, summary: current.summary };
      }

      const actionId = proposed.actionId;
      logInfo("workflow.waiting", {
        actionId,
        agentInstanceId,
        companyId,
        revision: round,
        ticketId,
      });

      const evt = await step.waitForEvent<DecisionEvent>(`wait-${actionId}`, {
        timeout: "60 days",
        type: `decision:${actionId}`,
      });

      const decision = await step.do(`decide-${round}`, async (): Promise<DecisionOutcome> => {
        logInfo("workflow.decision.received", {
          actionId,
          agentInstanceId,
          companyId,
          decidedByUserId: evt.payload.decidedByUserId,
          decision: evt.payload.decision,
          feedback: evt.payload.feedback ?? null,
          ticketId,
        });
        await decideAction(this.env.DB, {
          actionId,
          decidedByUserId: evt.payload.decidedByUserId,
          decision: evt.payload.decision,
          feedback: evt.payload.feedback,
        });
        if (evt.payload.decision === "approved") {
          await markExecuted(this.env.DB, actionId);
          await markTicketDone(this.env.DB, ticketId, { summary: current.summary });
          await emitTeamEvent(this.env, {
            companyId,
            reason: "ticket_changed",
            type: "team:status",
          });
          await logActivity(this.env, {
            actorId: evt.payload.decidedByUserId,
            companyId,
            refId: actionId,
            refType: "action",
            summary: "Ação aprovada e executada.",
            type: "ACTION_EXECUTED",
          });
          await this.presentToCustomer(companyId, ticketId, current.summary);
        } else if (evt.payload.decision === "rejected") {
          await setTicketStatus(this.env.DB, ticketId, "rejected");
          await emitTeamEvent(this.env, {
            companyId,
            reason: "ticket_changed",
            type: "team:status",
          });
          await logActivity(this.env, {
            actorId: evt.payload.decidedByUserId,
            companyId,
            payload: { feedback: evt.payload.feedback ?? null },
            refId: actionId,
            refType: "action",
            summary: "Ação rejeitada.",
            type: "ACTION_REJECTED",
          });
        } else {
          // request-changes: the Worker will rework (the loop regenerates with
          // this feedback). Back to in_progress while it does.
          await setTicketStatus(this.env.DB, ticketId, "in_progress");
          await emitTeamEvent(this.env, {
            companyId,
            reason: "ticket_changed",
            type: "team:status",
          });
          await logActivity(this.env, {
            actorId: evt.payload.decidedByUserId,
            companyId,
            payload: { feedback: evt.payload.feedback ?? null },
            refId: actionId,
            refType: "action",
            summary: "Alterações solicitadas.",
            type: "ACTION_CHANGES_REQUESTED",
          });
        }
        return evt.payload.decision;
      });

      if (decision === "approved" || decision === "rejected") {
        logInfo("workflow.ok", {
          agentInstanceId,
          companyId,
          decision,
          durationMs: Date.now() - workflowStart,
          revisions: round,
          ticketId,
        });
        return { decision, revisions: round, summary: current.summary };
      }

      // request-changes → loop and rework with the operator's note.
      priorSummary = current.summary;
      latestFeedback = evt.payload.feedback ?? null;
      revision = round + 1;

      if (revision === MAX_REVISIONS + 1) {
        // First time over the cap — tell the operator once that the Worker
        // won't rework further; they approve or reject the last version.
        await step.do("revise-capped", async () => {
          await logActivity(this.env, {
            companyId,
            payload: { revisions: MAX_REVISIONS },
            refId: actionId,
            refType: "action",
            summary: `Limite de ${MAX_REVISIONS} revisões atingido — o agente não vai refazer de novo. Aprove ou rejeite a última versão.`,
            type: "ACTION_REVISION_CAPPED",
          });
        });
        logInfo("workflow.revise.capped", { companyId, revision, ticketId });
      } else {
        logInfo("workflow.revise", { companyId, revision, ticketId });
      }
    }
    /* oxlint-enable no-await-in-loop */
  }
}

export { buildRevisionMessages, MAX_REVISIONS, WorkerJobWorkflow };
export type { WorkerJobParams };
