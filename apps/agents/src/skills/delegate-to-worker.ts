import { z } from "zod";

import { getDb } from "#/db/client";
import { getDelegationTargets } from "#/db/team";
import { setTicketWorkflowId } from "#/db/ticket";
import type { SkillContext, UnknownSkill } from "#/skills/registry";
import { emitTeamEvent } from "#/team/events";

const delegateInputSchema = z.object({
  brief: z
    .string()
    .min(1)
    .max(2000)
    .describe("Resumo claro da tarefa em pt-BR: o que o especialista precisa fazer."),
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
  const idx = Number(BigInt(Date.now()) % BigInt(pool.length));
  const chosen = pool[idx] ?? pool[0];
  return chosen ?? null;
};

const delegateToWorkerSkill: UnknownSkill = {
  description:
    "Delega uma tarefa a um especialista do Time. Use quando o pedido exige uma especialidade que você não executa diretamente (ex: criar imagem → designer).",
  async execute(input: unknown, ctx: SkillContext): Promise<DelegateResult> {
    const { brief, workerKind } = delegateInputSchema.parse(input);
    const db = getDb(ctx.env);
    const rows = await db.agentInstance.findMany({
      include: {
        _count: {
          select: {
            tickets: { where: { status: { in: ["in_progress", "awaiting_approval"] } } },
          },
        },
      },
      where: {
        companyId: ctx.companyId,
        role: "worker",
        status: "active",
        template: { status: "active", workerKind },
      },
    });
    const candidates: Array<WorkerCandidate> = rows.map((row) => ({
      // oxlint-disable-next-line no-underscore-dangle -- Prisma aggregate result.
      busy_count: row._count.tickets,
      id: row.id,
    }));

    if (candidates.length === 0) {
      return { error: `Nenhum especialista do tipo "${workerKind}" no Time desta empresa.` };
    }

    const delegationTargets = await getDelegationTargets(db, ctx.agentInstanceId);
    const target = pickWorker(candidates, delegationTargets ?? []);
    if (!target) {
      return { error: `Você não tem permissão para delegar para "${workerKind}".` };
    }

    const ticketId = crypto.randomUUID();
    // oxlint-disable-next-line react-doctor/async-parallel -- ordered: the ticket row must exist before the workflow starts, and the workflow id comes from the create call
    await db.ticket.create({
      data: {
        agentInstanceId: target.id,
        brief,
        companyId: ctx.companyId,
        id: ticketId,
        origin: "delegation",
        title: `${workerKind}: ${brief.slice(0, 80)}`,
      },
    });

    const instance = await ctx.env.WORKER_JOB.create({
      id: ticketId,
      params: { agentInstanceId: target.id, companyId: ctx.companyId, ticketId },
    });
    await setTicketWorkflowId(db, ticketId, instance.id);
    await emitTeamEvent(ctx.env, {
      companyId: ctx.companyId,
      reason: "ticket_changed",
      type: "team:status",
    });
    return { status: "queued", ticketId, workflowId: instance.id };
  },
  id: "delegateToWorker",
  inputSchema: delegateInputSchema,
};

export { delegateToWorkerSkill };
