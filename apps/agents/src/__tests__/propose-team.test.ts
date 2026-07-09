import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { proposeTeamSkill } from "#/skills/propose-team";
import type { SkillContext } from "#/skills/registry";

const COMPANY_ID = "co_propose_test";

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
     VALUES (?, 'Propose Test', 'propose-test', 'America/Sao_Paulo', 'pt-BR', 'onboarding', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company_template_entitlement
       (company_id, template_id, enabled, created_at, updated_at)
     SELECT ?, id, 1, 0, 0 FROM template WHERE status = 'active'`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("proposeTeam", () => {
  it("returns the live catalog as candidates (Designer is seeded by P3 migration)", async () => {
    const result = (await proposeTeamSkill.execute({}, ctx)) as {
      brief: Record<string, unknown>;
      candidates: ReadonlyArray<{ id: string; workerKind: string }>;
    };
    expect(result.candidates.some((c) => c.id === "tpl-designer")).toBe(true);
    expect(result.candidates.every((c) => c.workerKind.length > 0)).toBe(true);
  });

  it("includes the brief so the Planner can present it back to the user", async () => {
    await env.DB.prepare("UPDATE company SET brief = ? WHERE id = ?")
      .bind(JSON.stringify({ industry: "alimentação" }), COMPANY_ID)
      .run();
    const result = (await proposeTeamSkill.execute({}, ctx)) as {
      brief: { industry?: string };
    };
    expect(result.brief.industry).toBe("alimentação");
  });
});
