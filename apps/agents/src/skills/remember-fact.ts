import { z } from "zod";

import { getDb } from "#/db/client";
import { insertMemoryFact } from "#/db/schema";
import { getMemoryAdapter } from "#/lib/memory";
import type { SkillContext, SkillInput, UnknownSkill } from "#/skills/registry";

const rememberFactInputSchema = z.object({
  content: z.string().min(1).describe("O fato a ser lembrado, em uma frase clara em pt-BR."),
  kind: z
    .string()
    .optional()
    .describe("Categoria do fato (ex: 'preference', 'decision', 'brand'). Default: 'fact'."),
});

const rememberFactSkill: UnknownSkill = {
  description:
    "Salva um fato importante que você deve lembrar em conversas futuras (preferências, decisões, fatos do negócio).",
  async execute(input: SkillInput, ctx: SkillContext): Promise<{ id: string; savedAt: number }> {
    const { content, kind } = rememberFactInputSchema.parse(input);
    const id = crypto.randomUUID();
    const factKind = kind ?? "fact";
    const now = Date.now();
    await insertMemoryFact(getDb(ctx.env), {
      agentInstanceId: ctx.agentInstanceId,
      companyId: ctx.companyId,
      content,
      id,
      kind: factKind,
    });
    const memory = getMemoryAdapter(ctx.env);
    await memory.upsert({
      agentInstanceId: ctx.agentInstanceId,
      companyId: ctx.companyId,
      content,
      createdAt: now,
      id,
      kind: factKind,
    });
    return { id, savedAt: now };
  },
  id: "rememberFact",
  inputSchema: rememberFactInputSchema,
};

export { rememberFactSkill };
