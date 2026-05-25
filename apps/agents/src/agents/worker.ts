import { Agent } from "agents";
import { generateText, stepCountIs } from "ai";

import { getTemplate } from "@/db/template";
import { getModel } from "@/lib/ai-gateway";
import { buildSkillTools } from "@/skills/registry";

// Task-facing agent. Unlike the Correspondent (chat-facing, AIChatAgent), the
// Worker is invoked by RPC with a ticket id — no WebSocket, no recent-turns
// buffer. P3 runs `generateText` inline; P4 will hand the work off to a
// Cloudflare Workflow so long jobs survive eviction and the approval loop
// has a place to pause.

type HandleTicketResult = { error: string; ok: false } | { ok: true; summary: string };

type TicketRow = {
  agent_instance_id: string;
  brief: string;
  company_id: string;
  id: string;
};

type AgentInstanceRow = { id: string; template_id: string | null };

class WorkerAgent extends Agent<Env> {
  // Test seam — same pattern as the Correspondent. Tests inject a scripted
  // model by reassigning this method on the live instance.
  resolveModel(modelId: string) {
    return getModel(this.env, modelId);
  }

  async handleTicket(ticketId: string): Promise<HandleTicketResult> {
    const ticket = await this.loadTicket(ticketId);
    if (!ticket) {
      return { error: `ticket ${ticketId} not found`, ok: false };
    }
    const agentInstance = await this.loadAgentInstance(ticket.agent_instance_id);
    if (!agentInstance?.template_id) {
      return { error: "agent_instance has no template — cannot resolve config", ok: false };
    }
    const template = await getTemplate(this.env.DB, agentInstance.template_id);
    if (!template) {
      return { error: `template ${agentInstance.template_id} not found`, ok: false };
    }

    const tools = await buildSkillTools(
      { agentInstanceId: agentInstance.id, companyId: ticket.company_id, env: this.env },
      template.skillIds,
    );

    await this.markStatus(ticketId, "in_progress");

    try {
      const result = await generateText({
        messages: [{ content: ticket.brief, role: "user" }],
        model: this.resolveModel(template.model),
        stopWhen: stepCountIs(5),
        system: template.systemPrompt,
        tools,
      });
      const summary = result.text.trim();
      await this.persistResult(ticketId, summary);
      return { ok: true, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markStatus(ticketId, "blocked");
      return { error: message, ok: false };
    }
  }

  private async loadAgentInstance(id: string): Promise<AgentInstanceRow | null> {
    const row = await this.env.DB.prepare("SELECT id, template_id FROM agent_instance WHERE id = ?")
      .bind(id)
      .first<AgentInstanceRow>();
    return row;
  }

  private async loadTicket(id: string): Promise<TicketRow | null> {
    const row = await this.env.DB.prepare(
      "SELECT id, company_id, agent_instance_id, brief FROM ticket WHERE id = ?",
    )
      .bind(id)
      .first<TicketRow>();
    return row;
  }

  private async markStatus(ticketId: string, status: string): Promise<void> {
    await this.env.DB.prepare("UPDATE ticket SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, Date.now(), ticketId)
      .run();
  }

  private async persistResult(ticketId: string, summary: string): Promise<void> {
    await this.env.DB.prepare(
      "UPDATE ticket SET status = 'done', result = ?, updated_at = ? WHERE id = ?",
    )
      .bind(JSON.stringify({ summary }), Date.now(), ticketId)
      .run();
  }
}

export { WorkerAgent };
