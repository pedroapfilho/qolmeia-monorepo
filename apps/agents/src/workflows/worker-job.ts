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

// One generic Workflow class for every Worker job (decision 1 in the P4 plan).
// The Workflow is the *task's* lifecycle; the Worker DO is the agent's
// *identity*. step.do checkpoints survive eviction; step.waitForEvent pauses
// until the User decides, at zero cost.
//
// P4 ships a minimum-viable approval loop: every Worker output is a single
// "worker_deliverable" action. Specific action types (publish_post,
// send_email) come with the workers that need them in later phases — the
// resolvePolicy table grows; the Workflow shape stays the same.

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

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  async run(event: Readonly<WorkflowEvent<WorkerJobParams>>, step: WorkflowStep): Promise<unknown> {
    const { agentInstanceId, companyId, ticketId } = event.payload;
    const workflowStart = Date.now();

    logInfo("workflow.start", { agentInstanceId, companyId, ticketId });

    const generated = await step.do("generate", async (): Promise<GenerateResult> => {
      const stepStart = Date.now();
      const ticket = await loadTicket(this.env.DB, ticketId);
      const agentInstance = await loadAgentInstance(this.env.DB, agentInstanceId);
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
        skillIds: template.skillIds,
        templateId: template.id,
        ticketId,
      });
      const tools = await buildSkillTools(
        { agentInstanceId: agentInstance.id, companyId, env: this.env },
        template.skillIds,
      );
      const result = await generateText({
        messages: [{ content: ticket.brief, role: "user" }],
        model: getModel(this.env, template.model),
        stopWhen: stepCountIs(5),
        system: template.systemPrompt,
        tools,
      });
      const summary = result.text.trim();
      // Collect tool-call outputs so the propose-deliverable step can
      // attach structured fields to the action payload. The AI SDK exposes
      // tool results on `step.toolResults[i].result` (last-write-wins per
      // skill id — Workers should call each skill at most once per ticket).
      // The AI SDK emits tool outputs as already-JSON values; we collect
      // them keyed by skill id, then JSON.stringify at the step boundary
      // (see GenerateResult.skillResultsJson for the typing rationale).
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
        skillResultNames: Object.keys(skillResults),
        ticketId,
        toolCallNames: (result.steps ?? []).flatMap((s) =>
          (s.toolCalls ?? []).map((tc) => tc.toolName),
        ),
        usage: result.usage,
      });
      return { skillResultsJson: JSON.stringify(skillResults), summary };
    });

    const proposed = await step.do("propose-deliverable", async (): Promise<ProposeResult> => {
      const agentInstance = await loadAgentInstance(this.env.DB, agentInstanceId);
      if (!agentInstance?.templateId) {
        throw new Error("agent_instance vanished mid-workflow");
      }
      const template = await getTemplate(this.env.DB, agentInstance.templateId);
      const company = await getCompany(this.env.DB, companyId);
      if (!template || !company) {
        throw new Error("template or company vanished mid-workflow");
      }
      const actionType = template.defaultActionType;
      const policy = resolvePolicy(actionType, template);

      if (policy === "auto-execute") {
        await markTicketDone(this.env.DB, ticketId, { summary: generated.summary });
        await logActivity(this.env, {
          companyId,
          refId: ticketId,
          refType: "ticket",
          summary: "Ticket concluído automaticamente (auto-execute).",
          type: "TICKET_DONE",
        });
        return { actionId: null, policy };
      }

      // Action-type-specific structured payload. publish_post pulls the
      // draftSocialPost tool result so the backoffice renderer can show
      // platform/body/CTA/hashtags. Other action types fall back to the
      // text summary; adding a new structured renderer is one branch here
      // plus a backoffice renderer in `components/action-renderers/`.
      const skillResults = JSON.parse(generated.skillResultsJson) as Record<string, unknown>;
      const draft = skillResults.draftSocialPost;
      const proposedPayload: Record<string, unknown> = {
        summary: generated.summary,
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
      await logActivity(this.env, {
        companyId,
        payload: { actionId, summary: generated.summary },
        refId: actionId,
        refType: "action",
        summary: "Ação proposta aguardando decisão.",
        type: "ACTION_PROPOSED",
      });

      // Notify the Correspondent so the User sees the proposal. RPC failure
      // shouldn't fail the Workflow — the action row exists in D1, the
      // backoffice can surface it manually as a fallback.
      try {
        const corr = await getAgentByName(this.env.CORRESPONDENT, companyId);
        await corr.presentAction(actionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("workflow.presentAction.err", { actionId, companyId, error: message });
      }

      logInfo("workflow.propose.ok", {
        actionId,
        agentInstanceId,
        companyId,
        policy,
        ticketId,
      });

      return { actionId, policy };
    });

    if (!proposed.actionId) {
      logInfo("workflow.auto-execute", {
        agentInstanceId,
        companyId,
        durationMs: Date.now() - workflowStart,
        ticketId,
      });
      return { ok: true, summary: generated.summary };
    }

    logInfo("workflow.waiting", {
      actionId: proposed.actionId,
      agentInstanceId,
      companyId,
      ticketId,
    });

    const evt = await step.waitForEvent<DecisionEvent>(`wait-${proposed.actionId}`, {
      timeout: "60 days",
      type: `decision:${proposed.actionId}`,
    });

    await step.do("apply-decision", async () => {
      const actionId = proposed.actionId;
      if (!actionId) {
        return;
      }
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
        await markTicketDone(this.env.DB, ticketId, { summary: generated.summary });
        await logActivity(this.env, {
          actorId: evt.payload.decidedByUserId,
          companyId,
          refId: actionId,
          refType: "action",
          summary: "Ação aprovada e executada.",
          type: "ACTION_EXECUTED",
        });
      } else if (evt.payload.decision === "rejected") {
        await setTicketStatus(this.env.DB, ticketId, "rejected");
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
        // changes_requested — back to in_progress so a re-run is possible.
        // P4 doesn't auto re-trigger; that's a P5 polish.
        await setTicketStatus(this.env.DB, ticketId, "in_progress");
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
    });

    logInfo("workflow.ok", {
      agentInstanceId,
      companyId,
      decision: evt.payload.decision,
      durationMs: Date.now() - workflowStart,
      ticketId,
    });
    return { decision: evt.payload.decision, summary: generated.summary };
  }
}

export { WorkerJobWorkflow };
export type { DecisionEvent, WorkerJobParams };
