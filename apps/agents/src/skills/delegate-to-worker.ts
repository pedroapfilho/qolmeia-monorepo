import { getAgentByName } from "agents";
import { z } from "zod";

import { getDelegationTargets } from "@/db/team";
import type { SkillContext, UnknownSkill } from "@/skills/registry";

// Delegates a task to a specialist Worker on this Company's Team. In P3 the
// call awaits the Worker's response inline — clean tool-call ergonomics for
// the model, fine for short jobs. P4 makes it async via Cloudflare Workflows
// so long jobs survive eviction and pause for approvals.
const delegateInputSchema = z.object({
  brief: z
    .string()
    .min(1)
    .max(2000)
    .describe("Resumo claro da tarefa em pt-BR — o que o especialista precisa fazer."),
  workerKind: z
    .string()
    .min(1)
    .describe("Tipo do especialista (ex: 'designer', 'marketing-strategist')."),
});

type DelegateResult =
  | { error: string; ticketId?: string }
  | { status: "queued"; ticketId: string; workflowId: string };

type WorkerLookup = { id: string };

const delegateToWorkerSkill: UnknownSkill = {
  description:
    "Delega uma tarefa a um especialista do Time. Use quando o pedido exige uma especialidade que você não executa diretamente (ex: criar imagem → designer).",
  async execute(input: unknown, ctx: SkillContext): Promise<DelegateResult> {
    const { brief, workerKind } = delegateInputSchema.parse(input);

    const target = await ctx.env.DB.prepare(
      `SELECT a.id
         FROM agent_instance a
         JOIN template t ON t.id = a.template_id
        WHERE a.company_id = ?
          AND a.role = 'worker'
          AND a.status = 'active'
          AND t.worker_kind = ?
          AND t.status = 'active'
        LIMIT 1`,
    )
      .bind(ctx.companyId, workerKind)
      .first<WorkerLookup>();

    if (!target) {
      return { error: `Nenhum especialista do tipo "${workerKind}" no Time desta empresa.` };
    }

    const delegationTargets = await getDelegationTargets(ctx.env.DB, ctx.agentInstanceId);
    if (!delegationTargets?.includes(target.id)) {
      return { error: `Você não tem permissão para delegar para ${target.id}.` };
    }

    const ticketId = crypto.randomUUID();
    const now = Date.now();
    await ctx.env.DB.prepare(
      `INSERT INTO ticket
         (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
          status, origin, workflow_id, result, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'open', 'delegation', NULL, NULL, ?, ?)`,
    )
      .bind(
        ticketId,
        ctx.companyId,
        target.id,
        `${workerKind}: ${brief.slice(0, 80)}`,
        brief,
        now,
        now,
      )
      .run();

    const stub = await getAgentByName(ctx.env.WORKER_AGENT, target.id);
    const result = await stub.handleTicket(ticketId);

    if (!result.ok) {
      return { error: result.error, ticketId };
    }
    // P4: the Workflow runs asynchronously and pauses for approval. The
    // Correspondent's User-facing reply is "the Designer is working on it";
    // the actual deliverable arrives later via Correspondent.presentAction.
    return { status: "queued", ticketId, workflowId: result.workflowId };
  },
  id: "delegateToWorker",
  inputSchema: delegateInputSchema,
};

export { delegateToWorkerSkill };
