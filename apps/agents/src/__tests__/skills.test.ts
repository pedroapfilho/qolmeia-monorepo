import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { recallMemorySkill } from "#/skills/recall-memory";
import type { SkillContext } from "#/skills/registry";
import { rememberFactSkill } from "#/skills/remember-fact";

const COMPANY_ID = "co_skills_test";
const AGENT_INSTANCE_ID = "agent_skills_test";

const ctx: SkillContext = {
  agentInstanceId: AGENT_INSTANCE_ID,
  companyId: COMPANY_ID,
  get env() {
    return env;
  },
};

beforeEach(async () => {
  // Seed the FKs `memory_fact` references.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Skills Test', 'skills-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, created_at, updated_at)
     VALUES (?, ?, 'correspondent', NULL, NULL, 'Test Correspondent',
             NULL, 'active', 0, 0)`,
  )
    .bind(AGENT_INSTANCE_ID, COMPANY_ID)
    .run();
});

describe("rememberFact", () => {
  it("writes a memory_fact row and returns an id + timestamp", async () => {
    const result = (await rememberFactSkill.execute(
      { content: "minha cor preferida é azul", kind: "preference" },
      ctx,
    )) as { id: string; savedAt: number };

    expect(result.id).toBeTruthy();
    expect(result.savedAt).toBeGreaterThan(0);

    const { results } = await env.DB.prepare("SELECT content, kind FROM memory_fact WHERE id = ?")
      .bind(result.id)
      .all<{ content: string; kind: string }>();
    expect(results[0]?.content).toBe("minha cor preferida é azul");
    expect(results[0]?.kind).toBe("preference");
  });
});

describe("recallMemory", () => {
  it("returns facts upserted by rememberFact for the same agent", async () => {
    // The in-memory dev adapter uses a crude trigram embedding (quality is not
    // the goal — plumbing is). High lexical overlap is needed to clear the
    // 0.5 default minScore. Production (bge-m3) is the actual recall quality
    // surface and is exercised at deploy.
    await rememberFactSkill.execute(
      { content: "minha cor preferida é azul marinho", kind: "preference" },
      ctx,
    );
    const result = (await recallMemorySkill.execute({ query: "minha cor preferida" }, ctx)) as {
      matches: ReadonlyArray<{ content: string }>;
    };
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((m) => m.content.includes("azul marinho"))).toBe(true);
  });
});
