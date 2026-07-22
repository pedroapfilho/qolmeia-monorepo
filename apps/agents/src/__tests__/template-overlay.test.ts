import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { getTemplate, listSkillOverlays } from "#/db/template";
import { buildFlueTools } from "#/lib/skill-tool";
import { buildSkillTools, registerSkill, type UnknownSkill } from "#/skills/registry";

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
  it("reads the seeded Designer template from Prisma", async () => {
    const t = await getTemplate(env.DB, "tpl-designer");
    expect(t?.workerKind).toBe("designer");
    expect(t?.skillIds).toContain("generateBrandImage");
    expect(t?.defaultPolicies.publish_asset).toBe("require-approval");
  });

  it("listSkillOverlays returns only the requested ids", async () => {
    const overlays = await listSkillOverlays(env.DB, ["generateBrandImage", "delegateToWorker"]);
    expect(overlays.map((o) => o.id).toSorted()).toEqual([
      "delegateToWorker",
      "generateBrandImage",
    ]);
    expect(overlays.every((o) => o.enabled)).toBe(true);
  });
});

describe("buildSkillTools — Prisma overlay join", () => {
  it("uses the database overlay description over the code default when present", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 1, 0)`,
    )
      .bind("fake-overlay-skill", "Fake", "Database overlay description")
      .run();

    const tools = await buildSkillTools(
      { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env },
      ["fake-overlay-skill"],
    );
    expect(tools["fake-overlay-skill"]?.description).toBe("Database overlay description");
  });

  it("falls back to the code description when no database overlay row exists", async () => {
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
      buildSkillTools({ agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env }, [
        "this-skill-does-not-exist",
      ]),
    ).rejects.toThrow(/unknown skill id/v);
  });

  it("skips a skill when its overlay is disabled", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES ('disabled-skill', 'Disabled', 'd', NULL, NULL, 0, 0)`,
    ).run();
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

describe("buildFlueTools — agents share the overlay + kill-switch core", () => {
  const ctx = { agentInstanceId: AGENT_INSTANCE_ID, companyId: COMPANY_ID, env };

  it("omits a skill whose database overlay is disabled (the kill-switch reaches the Flue agents)", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES ('flue-disabled', 'Flue Disabled', 'd', NULL, NULL, 0, 0)`,
    ).run();
    registerSkill({
      description: "x",
      execute: () => Promise.resolve({ ok: true }),
      id: "flue-disabled",
      inputSchema: z.object({}),
    });

    const tools = await buildFlueTools(ctx, ["flue-disabled"]);
    expect(tools).toHaveLength(0);
  });

  it("uses the database overlay description for the agent's tool", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO skill
         (id, display_name, description, param_hints, default_config, enabled, updated_at)
       VALUES ('flue-described', 'Flue Described', 'Database desc for the agent', NULL, NULL, 1, 0)`,
    ).run();
    registerSkill({
      description: "code desc",
      execute: () => Promise.resolve({ ok: true }),
      id: "flue-described",
      inputSchema: z.object({}),
    });

    const tools = await buildFlueTools(ctx, ["flue-described"]);
    expect(tools.find((t) => t.name === "flue-described")?.description).toBe(
      "Database desc for the agent",
    );
  });

  it("throws when an agent references an unknown skill id", async () => {
    await expect(buildFlueTools(ctx, ["nope-not-a-skill"])).rejects.toThrow(/unknown skill id/v);
  });
});
