import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { parseBrief } from "#/lib/company-brief";
import { extractBriefSkill } from "#/skills/extract-brief";
import type { SkillContext } from "#/skills/registry";

const COMPANY_ID = "co_extract_test";

const ctx: SkillContext = {
  agentInstanceId: `planner-${COMPANY_ID}`,
  companyId: COMPANY_ID,
  get env() {
    return env;
  },
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Extract Test', 'extract-test', 'America/Sao_Paulo', 'pt-BR', 'onboarding', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("extractBrief", () => {
  it("writes the first partial brief to company.brief", async () => {
    const result = (await extractBriefSkill.execute({ industry: "cafeteria" }, ctx)) as {
      brief: { industry?: string };
    };
    expect(result.brief.industry).toBe("cafeteria");

    const row = await env.DB.prepare("SELECT brief FROM company WHERE id = ?")
      .bind(COMPANY_ID)
      .first<{ brief: string | null }>();
    expect(parseBrief(row?.brief).industry).toBe("cafeteria");
  });

  it("merges sequential calls without overwriting earlier fields", async () => {
    await extractBriefSkill.execute({ industry: "cafeteria" }, ctx);
    await extractBriefSkill.execute({ audience: "jovens profissionais" }, ctx);
    await extractBriefSkill.execute({ primaryGoal: "dobrar vendas" }, ctx);

    const row = await env.DB.prepare("SELECT brief FROM company WHERE id = ?")
      .bind(COMPANY_ID)
      .first<{ brief: string | null }>();
    const brief = parseBrief(row?.brief);
    expect(brief.industry).toBe("cafeteria");
    expect(brief.audience).toBe("jovens profissionais");
    expect(brief.primaryGoal).toBe("dobrar vendas");
  });
});
