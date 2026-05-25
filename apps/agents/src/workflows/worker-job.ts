import { getAgentByName } from "agents";
import { generateText, stepCountIs } from "ai";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { decideAction, markExecuted, proposeAction } from "@/db/action";
import { getCompany } from "@/db/schema";
import { resolvePolicy } from "@/db/policy";
import { getTemplate } from "@/db/template";
import {
  loadAgentInstance,
  loadTicket,
  markTicketDone,
  setTicketStatus,
} from "@/db/ticket";
import { getModel } from "@/lib/ai-gateway";
import { buildSkillTools } from "@/skills/registry";
import type { DecisionOutcome } from "@/db/action";

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

type GenerateResult = { summary: string };

type ProposeResult = { actionId: string | null; policy: string };

type DecisionEvent = {
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

class WorkerJobWorkflow extends WorkflowEntrypoint<Env, WorkerJobParams> {
  async run(
    event: Readonly<WorkflowEvent<WorkerJobParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const { agentInstanceId, companyId, ticketId } = event.payload;

    const generated = await step.do("generate", async (): Promise<GenerateResult> => {
      const ticket = await loadTicket(this.env.DB, ticketId);
      const agentInstance = await loadAgentInstance(this.env.DB, agentInstanceId);
      if (!ticket || !agentInstance?.templateId) {
        throw new Error(`ticket ${ticketId} or its agent_instance not properly seeded`);
      }
      const template = await getTemplate(this.env.DB, agentInstance.templateId);
      if (!template) {
        throw new Error(`template ${agentInstance.templateId} not found`);
      }
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
      return { summary: result.text.trim() };
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
      const policy = resolvePolicy("worker_deliverable", template);

      if (policy === "auto-execute") {
        await markTicketDone(this.env.DB, ticketId, { summary: generated.summary });
        return { actionId: null, policy };
      }

      const { id: actionId } = await proposeAction(this.env.DB, {
        actionType: "worker_deliverable",
        companyId,
        policy,
        proposed: { summary: generated.summary, ticketId },
        ticketId,
      });
      await setTicketStatus(this.env.DB, ticketId, "awaiting_approval");

      // Notify the Correspondent so the User sees the proposal. RPC failure
      // shouldn't fail the Workflow — the action row exists in D1, the
      // backoffice can surface it manually as a fallback.
      try {
        const corr = await getAgentByName(this.env.CORRESPONDENT, companyId);
        await corr.presentAction(actionId);
      } catch (error) {
        // oxlint-disable-next-line no-console
        console.error("[workflow] presentAction RPC failed", { actionId, error });
      }

      return { actionId, policy };
    });

    if (!proposed.actionId) {
      return { ok: true, summary: generated.summary };
    }

    const evt = await step.waitForEvent<DecisionEvent>(`wait-${proposed.actionId}`, {
      timeout: "60 days",
      type: `decision:${proposed.actionId}`,
    });

    await step.do("apply-decision", async () => {
      const actionId = proposed.actionId;
      if (!actionId) {
        return;
      }
      await decideAction(this.env.DB, {
        actionId,
        decidedByUserId: evt.payload.decidedByUserId,
        decision: evt.payload.decision,
        feedback: evt.payload.feedback,
      });
      if (evt.payload.decision === "approved") {
        await markExecuted(this.env.DB, actionId);
        await markTicketDone(this.env.DB, ticketId, { summary: generated.summary });
      } else if (evt.payload.decision === "rejected") {
        await setTicketStatus(this.env.DB, ticketId, "rejected");
      } else {
        // changes_requested — back to in_progress so a re-run is possible.
        // P4 doesn't auto re-trigger; that's a P5 polish.
        await setTicketStatus(this.env.DB, ticketId, "in_progress");
      }
    });

    return { decision: evt.payload.decision, summary: generated.summary };
  }
}

export { WorkerJobWorkflow };
export type { DecisionEvent, WorkerJobParams };
