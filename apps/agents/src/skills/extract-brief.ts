import { companyBriefSchema, mergeBrief, parseBrief } from "#/lib/company-brief";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

const extractBriefInputSchema = companyBriefSchema.partial();

type CompanyRow = { brief: string | null };

const extractBriefSkill: UnknownSkill = {
  description:
    "Atualiza o brief da empresa com o que você acabou de aprender na conversa. Envie apenas os campos que mudaram — campos não enviados são preservados. Chame conforme a conversa evolui.",
  async execute(input: unknown, ctx: SkillContext): Promise<{ brief: Record<string, unknown> }> {
    const updates = extractBriefInputSchema.parse(input);

    const row = await ctx.env.DB.prepare("SELECT brief FROM company WHERE id = ?")
      .bind(ctx.companyId)
      .first<CompanyRow>();
    const existing = parseBrief(row?.brief);
    const merged = mergeBrief(existing, updates);

    await ctx.env.DB.prepare("UPDATE company SET brief = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(merged), Date.now(), ctx.companyId)
      .run();

    return { brief: merged };
  },
  id: "extractBrief",
  inputSchema: extractBriefInputSchema,
};

export { extractBriefSkill };
