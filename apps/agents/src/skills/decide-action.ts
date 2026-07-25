import { z } from "zod";

import { getAction } from "#/db/action";
import { getDb } from "#/db/client";
import { loadTicket } from "#/db/ticket";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

const decideActionInputSchema = z.object({
  actionId: z.string().min(1),
  decision: z.enum(["approved", "changes_requested", "rejected"]),
  feedback: z
    .string()
    .max(2000)
    .optional()
    .describe("Para changes_requested, repasse o que o cliente quer ajustado."),
});

type DecideResult = { decision: string; ok: true } | { error: string };

const decideActionSkill: UnknownSkill = {
  description:
    "Interprete a resposta do cliente a uma ação pendente e registre a decisão. Use quando houver uma ação no estado 'pending' e o cliente responder com aprovação, rejeição ou pedido de mudança.",
  async execute(input: unknown, ctx: SkillContext): Promise<DecideResult> {
    const { actionId, decision, feedback } = decideActionInputSchema.parse(input);

    const db = getDb(ctx.env);
    const action = await getAction(db, actionId);
    if (!action) {
      return { error: "Ação não encontrada." };
    }
    if (action.companyId !== ctx.companyId) {
      return { error: "Ação pertence a outra empresa." };
    }
    if (action.status !== "pending") {
      return { error: `Ação já está em estado '${action.status}', não é mais pendente.` };
    }

    const ticket = await loadTicket(db, action.ticketId);
    if (ticket === null || ticket.workflowId === null || ticket.workflowId === "") {
      return { error: "Workflow não encontrado para essa ação." };
    }

    const instance = await ctx.env.WORKER_JOB.get(ticket.workflowId);
    await instance.sendEvent({
      payload: {
        decidedByUserId: ctx.agentInstanceId,
        decision,
        feedback,
      },
      type: `decision:${actionId}`,
    });

    return { decision, ok: true };
  },
  id: "decideAction",
  inputSchema: decideActionInputSchema,
};

export { decideActionSkill };
