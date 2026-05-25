import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getTemplate, listSkillOverlays } from "@/db/template";
import { buildSkillTools, registerSkill, type UnknownSkill } from "@/skills/registry";
import { z } from "zod";

const COMPANY_ID = "co_tpl_test";
const AGENT_INSTANCE_ID = "agent_tpl_test";

const fakeOverlaySkill: UnknownSkill = {
  description: "code-side description",
  execute(): Promise<{ ok: true }> {
    return Promise.resolve({ ok: true });
  },
  id: "fake-overlay-skill",
  inputSchema: z.object({}),
};
registerSkill(fakeOverlaySkill);

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Tpl Test', 'tpl-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("getTemplate / listSkillOverlays", () => {
  it("reads the seeded Designer template from D1", async () => {
    // The migration seeds tpl-designer at apply-time; assert presence.
    const t = await getTemplate(env.DB, "tpl-designer");
    expect(t?.workerKind).toBe("designer");
    expect(t?.skillIds).toContain("generateBrandImage");
    expect(t?.defaultPolicies.publish_asset).toBe("require-approval");
  });

  it("listSkillOverlays returns only the requested ids", async () => {
    const overlays = await listSkillOverlays(env.DB, ["generateBrandImage", "delegateToWorker"]);
    expect(overlays.map((o) => o.id).toSorted()).toEqual(
      ["delegateToWorker", "generateBrandImage"],
    );
    expect(overlays.every((o) => o.enabled)).toBe(true);
  });
});

describe("buildSkillTools — D1 overlay join", () => {
  it("uses the D1 overlay description over the code default when present", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 1, 0)`,
    )
      .bind("fake-overlay-skill", "Fake", "D1-overlay description")
      .run();

    const tools = await buildSkillTools(
      { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env },
      ["fake-overlay-skill"],
    );
    expect(tools["fake-overlay-skill"]?.description).toBe("D1-overlay description");
  });

  it("falls back to the code description when no D1 overlay row exists", async () => {
    // Register a second code-only skill and don't seed an overlay row.
    const codeOnly: UnknownSkill = {
      description: "code-only desc",
      execute(): Promise<{ ok: true }> {
        return Promise.resolve({ ok: true });
      },
      id: "code-only-skill",
      inputSchema: z.object({}),
    };
    registerSkill(codeOnly);
    const tools = await buildSkillTools(
      { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env },
      ["code-only-skill"],
    );
    expect(tools["code-only-skill"]?.description).toBe("code-only desc");
  });

  it("throws when a template references an unknown skill id", async () => {
    await expect(
      buildSkillTools(
        { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env },
        ["this-skill-does-not-exist"],
      ),
    ).rejects.toThrow(/unknown skill id/v);
  });

  it("skips a skill when its overlay is disabled", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES ('disabled-skill', 'Disabled', 'd', NULL, NULL, 0, 0)`,
    )
      .run();
    const disabledSkill: UnknownSkill = {
      description: "x",
      execute(): Promise<{ ok: true }> {
        return Promise.resolve({ ok: true });
      },
      id: "disabled-skill",
      inputSchema: z.object({}),
    };
    registerSkill(disabledSkill);

    const tools = await buildSkillTools(
      { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env },
      ["disabled-skill"],
    );
    expect(tools["disabled-skill"]).toBeUndefined();
  });
});
