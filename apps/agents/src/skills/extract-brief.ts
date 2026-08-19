import { companyBriefSchema, type CompanyBrief } from "@repo/worker-api/brief";

import { getDb } from "#/db/client";
import type { SkillContext, SkillInput, UnknownSkill } from "#/skills/registry";

const extractBriefInputSchema = companyBriefSchema.partial();

const extractBriefSkill: UnknownSkill = {
  description:
    "Atualiza o brief da empresa com o que você acabou de aprender na conversa. Envie apenas os campos que mudaram; campos não enviados são preservados. Chame conforme a conversa evolui.",
  async execute(input: SkillInput, ctx: SkillContext): Promise<{ brief: CompanyBrief }> {
    const updates = extractBriefInputSchema.parse(input);

    const row = await getDb(ctx.env)("companies.updateBrief", {
      companyId: ctx.companyId,
      updates,
    });
    if (!row) {
      throw new Error(`company ${ctx.companyId} not found`);
    }
    return { brief: row.brief };
  },
  id: "extractBrief",
  inputSchema: extractBriefInputSchema,
};

export { extractBriefSkill };
