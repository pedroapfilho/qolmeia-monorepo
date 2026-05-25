import { companyBriefSchema, mergeBrief, parseBrief } from "@/lib/company-brief";
import type { SkillContext, UnknownSkill } from "@/skills/registry";

// Persists a partial CompanyBrief during the Planner debrief. The Planner's
// model fills in the fields it just learned and passes them via `updates` —
// the skill merges with what's already in D1 and writes back. Versioned via
// BRIEF_SCHEMA_VERSION (see lib/company-brief.ts). No second LLM call here —
// the chat-loop model already has context and produces the typed updates
// directly, halving the inference cost vs. a generateObject round-trip.
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
