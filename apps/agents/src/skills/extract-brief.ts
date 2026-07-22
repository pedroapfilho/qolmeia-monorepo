import { getDb } from "#/db/client";
import { companyBriefSchema, mergeBrief, parseBrief } from "#/lib/company-brief";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

const extractBriefInputSchema = companyBriefSchema.partial();

const extractBriefSkill: UnknownSkill = {
  description:
    "Atualiza o brief da empresa com o que você acabou de aprender na conversa. Envie apenas os campos que mudaram — campos não enviados são preservados. Chame conforme a conversa evolui.",
  async execute(input: unknown, ctx: SkillContext): Promise<{ brief: Record<string, unknown> }> {
    const updates = extractBriefInputSchema.parse(input);

    const db = getDb(ctx.env);
    const row = await db.company.findUnique({
      select: { brief: true },
      where: { id: ctx.companyId },
    });
    const existing = parseBrief(row?.brief);
    const merged = mergeBrief(existing, updates);

    await db.company.update({ data: { brief: merged }, where: { id: ctx.companyId } });

    return { brief: merged };
  },
  id: "extractBrief",
  inputSchema: extractBriefInputSchema,
};

export { extractBriefSkill };
