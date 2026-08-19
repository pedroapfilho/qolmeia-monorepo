import type { CompanyBriefPartial } from "@repo/worker-api/brief";
import { correspondentIdFor } from "@repo/worker-api/contracts";

import { getDb } from "#/db/client";
import { insertMemoryFact } from "#/db/schema";
import { getMemoryAdapter } from "#/lib/memory";

const seedCompanyMemory = async (
  env: Env,
  companyId: string,
  input: { brief: Partial<CompanyBriefPartial>; debriefSummary: string },
): Promise<void> => {
  const agentInstanceId = correspondentIdFor(companyId);
  const memory = getMemoryAdapter(env);
  const db = getDb(env);

  const facts: Array<{ content: string; kind: string }> = [];
  if (input.brief.industry !== undefined && input.brief.industry !== "") {
    facts.push({ content: `Setor: ${input.brief.industry}`, kind: "industry" });
  }
  if (input.brief.primaryGoal !== undefined && input.brief.primaryGoal !== "") {
    facts.push({ content: `Objetivo principal: ${input.brief.primaryGoal}`, kind: "goal" });
  }
  if (input.brief.audience !== undefined && input.brief.audience !== "") {
    facts.push({ content: `Público: ${input.brief.audience}`, kind: "audience" });
  }
  if (input.brief.channels !== undefined && input.brief.channels.length > 0) {
    facts.push({ content: `Canais ativos: ${input.brief.channels.join(", ")}`, kind: "channels" });
  }
  if (input.brief.brand?.voice !== undefined && input.brief.brand.voice !== "") {
    facts.push({ content: `Tom da marca: ${input.brief.brand.voice}`, kind: "brand_voice" });
  }
  if (input.brief.brand?.palette !== undefined && input.brief.brand.palette !== "") {
    facts.push({ content: `Paleta: ${input.brief.brand.palette}`, kind: "brand_palette" });
  }
  if (input.debriefSummary !== "") {
    facts.push({ content: input.debriefSummary, kind: "onboarding_summary" });
  }

  await Promise.all(
    facts.map(async (fact) => {
      const id = crypto.randomUUID();
      await insertMemoryFact(db, {
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
