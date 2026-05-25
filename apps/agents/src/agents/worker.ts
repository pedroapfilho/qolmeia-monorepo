import { Agent } from "agents";

import { loadAgentInstance, loadTicket, setTicketWorkflowId } from "@/db/ticket";

// Task-facing agent. The WorkerAgent DO holds identity + per-agent state;
// the heavy lifting (LLM, tool calls, approval loop) runs in a Cloudflare
// Workflow that the DO kicks off. This split survives DO eviction during
// long jobs and lets the approval flow pause at `step.waitForEvent` for as
// long as the User takes.

type HandleTicketResult = { error: string; ok: false } | { ok: true; workflowId: string };

class WorkerAgent extends Agent<Env> {
  async handleTicket(ticketId: string): Promise<HandleTicketResult> {
    const ticket = await loadTicket(this.env.DB, ticketId);
    if (!ticket) {
      return { error: `ticket ${ticketId} not found`, ok: false };
    }
    const agentInstance = await loadAgentInstance(this.env.DB, ticket.agentInstanceId);
    if (!agentInstance?.templateId) {
      return { error: "agent_instance has no template — cannot resolve config", ok: false };
    }

    // Idempotency: if the ticket already has a workflow_id, return it.
    // Re-creating with the same id throws (Workflows reject duplicate ids).
    if (ticket.workflowId) {
      return { ok: true, workflowId: ticket.workflowId };
    }

    const instance = await this.env.WORKER_JOB.create({
      id: ticketId,
      params: {
        agentInstanceId: ticket.agentInstanceId,
        companyId: ticket.companyId,
        ticketId,
      },
    });

    await setTicketWorkflowId(this.env.DB, ticketId, instance.id);
    return { ok: true, workflowId: instance.id };
  }
}

export { WorkerAgent };
