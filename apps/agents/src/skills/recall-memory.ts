import { z } from "zod";

import { getMemoryAdapter, type ScoredRecord } from "#/lib/memory";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

const recallMemoryInputSchema = z.object({
  query: z.string().min(1).describe("O que você está procurando, em uma frase clara em pt-BR."),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Quantos resultados retornar. Default: 4."),
});

type RecallResult = {
  matches: ReadonlyArray<Pick<ScoredRecord, "content" | "createdAt" | "kind" | "score">>;
};

const recallMemorySkill: UnknownSkill = {
  description:
    "Busca na memória deste agente fatos relevantes para uma consulta — use quando precisar de algo específico que pode estar fora do contexto atual.",
  async execute(input: unknown, ctx: SkillContext): Promise<RecallResult> {
    const { query, topK } = recallMemoryInputSchema.parse(input);
    const memory = getMemoryAdapter(ctx.env);
    const matches = await memory.retrieve({
      agentInstanceId: ctx.agentInstanceId,
      query,
      topK: topK ?? 4,
    });
    return {
      matches: matches.map((match) => ({
        content: match.content,
        createdAt: match.createdAt,
        kind: match.kind,
        score: match.score,
      })),
    };
  },
  id: "recallMemory",
  inputSchema: recallMemoryInputSchema,
};

export { recallMemorySkill };
