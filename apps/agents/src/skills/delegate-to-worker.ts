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

type WorkerCandidate = {
  busy_count: number;
  id: string;
};

const pickWorker = (
  candidates: ReadonlyArray<WorkerCandidate>,
  allowed: ReadonlyArray<string>,
): WorkerCandidate | null => {
  const eligible = candidates.filter((c) => allowed.includes(c.id));
  if (eligible.length === 0) {
    return null;
  }
  const idle = eligible.filter((c) => c.busy_count === 0);
  const pool = idle.length > 0 ? idle : eligible;
  // Round-robin across the pool by hashing the current time. Stable enough
  // for fair distribution under load, no per-DO state required.
  const idx = Number(BigInt(Date.now()) % BigInt(pool.length));
  // pool is non-empty (checked above), so pool[0] is always defined.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const chosen = pool[idx] ?? pool[0];
  return chosen ?? null;
};

const delegateToWorkerSkill: UnknownSkill = {
  description:
    "Delega uma tarefa a um especialista do Time. Use quando o pedido exige uma especialidade que você não executa diretamente (ex: criar imagem → designer).",
  async execute(input: unknown, ctx: SkillContext): Promise<DelegateResult> {
    const { brief, workerKind } = delegateInputSchema.parse(input);

    const { results: candidates } = await ctx.env.DB.prepare(
      `SELECT a.id,
              (SELECT COUNT(*) FROM ticket
                WHERE agent_instance_id = a.id
                  AND status IN ('in_progress', 'awaiting_approval')) AS busy_count
         FROM agent_instance a
         JOIN template t ON t.id = a.template_id
        WHERE a.company_id = ?
          AND a.role = 'worker'
          AND a.status = 'active'
          AND t.worker_kind = ?
          AND t.status = 'active'`,
    )
      .bind(ctx.companyId, workerKind)
      .all<WorkerCandidate>();

    if (candidates.length === 0) {
      return { error: `Nenhum especialista do tipo "${workerKind}" no Time desta empresa.` };
    }

    const delegationTargets = await getDelegationTargets(ctx.env.DB, ctx.agentInstanceId);
    const target = pickWorker(candidates, delegationTargets ?? []);
    if (!target) {
      return { error: `Você não tem permissão para delegar para "${workerKind}".` };
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
