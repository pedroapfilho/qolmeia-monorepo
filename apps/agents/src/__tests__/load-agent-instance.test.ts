import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { loadAgentInstance } from "#/db/ticket";

const COMPANY_ID = "co_lai_test";
const INSTANCE_ID = "ai_lai_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'LAI', 'lai', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, prompt_override, created_at, updated_at)
     VALUES (?, ?, 'worker', 'tpl-designer', 1, 'd', NULL, 'active', 'meu prompt', 0, 0)`,
  )
    .bind(INSTANCE_ID, COMPANY_ID)
    .run();
});

describe("loadAgentInstance", () => {
  it("returns promptOverride when set", async () => {
    const result = await loadAgentInstance(env.DB, INSTANCE_ID);
    expect(result).toEqual({
      id: INSTANCE_ID,
      promptOverride: "meu prompt",
      templateId: "tpl-designer",
    });
  });

  it("returns null promptOverride when unset", async () => {
    await env.DB.prepare("UPDATE agent_instance SET prompt_override = NULL WHERE id = ?")
      .bind(INSTANCE_ID)
      .run();
    const result = await loadAgentInstance(env.DB, INSTANCE_ID);
    expect(result?.promptOverride).toBeNull();
  });
});
