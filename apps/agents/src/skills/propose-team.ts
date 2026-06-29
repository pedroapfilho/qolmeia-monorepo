import { z } from "zod";

import { listActiveTemplates } from "#/db/template";
import { parseBrief } from "#/lib/company-brief";
import type { SkillContext, UnknownSkill } from "#/skills/registry";

const proposeTeamInputSchema = z.object({});

type TeamCandidate = {
  description: string;
  id: string;
  reason: string;
  workerKind: string;
};

type ProposeResult = {
  brief: Record<string, unknown>;
  candidates: ReadonlyArray<TeamCandidate>;
};

type CompanyRow = { brief: string | null };

const proposeTeamSkill: UnknownSkill = {
  description:
    "Lê o catálogo de especialistas disponíveis e propõe um Time para a empresa com base no brief atual. Use depois de coletar informação suficiente no debrief.",
  async execute(_input: unknown, ctx: SkillContext): Promise<ProposeResult> {
    const [templates, row] = await Promise.all([
      listActiveTemplates(ctx.env.DB),
      ctx.env.DB.prepare("SELECT brief FROM company WHERE id = ?")
        .bind(ctx.companyId)
        .first<CompanyRow>(),
    ]);
    const brief = parseBrief(row?.brief);
    const industry = typeof brief.industry === "string" ? brief.industry : "";

    const candidates: ReadonlyArray<TeamCandidate> = templates.map((t) => ({
      description: t.description,
      id: t.id,
      reason: industry
        ? `Especialista em ${t.workerKind}, adequado para ${industry}.`
        : `Especialista em ${t.workerKind}.`,
      workerKind: t.workerKind,
    }));

    return { brief, candidates };
  },
  id: "proposeTeam",
  inputSchema: proposeTeamInputSchema,
};

export { proposeTeamSkill };
