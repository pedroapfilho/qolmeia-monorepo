import { insertMemoryFact } from "#/db/schema";
import type { CompanyBriefPartial } from "#/lib/company-brief";
import { getMemoryAdapter } from "#/lib/memory";

// Seeds the Correspondent's long-term memory from the confirmed brief at team
// confirmation. DO-independent (writes to D1 + the memory adapter), so it runs
// directly from the team-confirm route — no agent round-trip. Was the
// CorrespondentAgent.seedMemory DO RPC.
const seedCompanyMemory = async (
  env: Env,
  companyId: string,
  input: { brief: Partial<CompanyBriefPartial>; debriefSummary: string },
): Promise<void> => {
  const agentInstanceId = `corr-${companyId}`;
  const memory = getMemoryAdapter(env);

  const facts: Array<{ content: string; kind: string }> = [
    input.brief.industry && { content: `Setor: ${input.brief.industry}`, kind: "industry" },
    input.brief.primaryGoal && {
      content: `Objetivo principal: ${input.brief.primaryGoal}`,
      kind: "goal",
    },
    input.brief.audience && { content: `Público: ${input.brief.audience}`, kind: "audience" },
    input.brief.channels?.length && {
      content: `Canais ativos: ${input.brief.channels.join(", ")}`,
      kind: "channels",
    },
    input.brief.brand?.voice && {
      content: `Tom da marca: ${input.brief.brand.voice}`,
      kind: "brand_voice",
    },
    input.brief.brand?.palette && {
      content: `Paleta: ${input.brief.brand.palette}`,
      kind: "brand_palette",
    },
    input.debriefSummary && { content: input.debriefSummary, kind: "onboarding_summary" },
  ].filter(Boolean) as Array<{ content: string; kind: string }>;

  await Promise.all(
    facts.map(async (fact) => {
      const id = crypto.randomUUID();
      await insertMemoryFact(env.DB, {
        agentInstanceId,
        companyId,
        content: fact.content,
        id,
        kind: fact.kind,
      });
      await memory.upsert({
        agentInstanceId,
        companyId,
        content: fact.content,
        createdAt: Date.now(),
        id,
        kind: fact.kind,
      });
    }),
  );
};

export { seedCompanyMemory };
