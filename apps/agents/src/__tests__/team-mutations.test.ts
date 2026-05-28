import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { hireMember, pauseMember, resumeMember, updateMember } from "@/team/mutations";

const COMPANY_ID = "co_hire_test";
const TEAM_ID = `team-${COMPANY_ID}`;
const CORR_ID = `corr-${COMPANY_ID}`;

beforeEach(async () => {
  // Clean up workers and activity rows from prior tests so each test starts
  // with a clean slate for the hire company.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM team_member WHERE team_id = ? AND agent_instance_id != ?").bind(
      TEAM_ID,
      CORR_ID,
    ),
    env.DB.prepare("DELETE FROM agent_instance WHERE company_id = ? AND role = 'worker'").bind(
      COMPANY_ID,
    ),
    env.DB.prepare("DELETE FROM activity_log WHERE company_id = ?").bind(COMPANY_ID),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'H', 'h', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'sys', 'gpt-x',
               'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'Correspondente', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(TEAM_ID, COMPANY_ID, 0, 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(TEAM_ID, CORR_ID),
  ]);
});

describe("hireMember", () => {
  it("creates a new agent_instance + team_member and appends to correspondent's delegation list", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    expect(member.displayName).toBe("Designer");
    expect(member.role).toBe("worker");
    expect(member.templateId).toBe("tpl-designer");

    const corrRow = await env.DB.prepare(
      "SELECT can_delegate_to FROM team_member WHERE agent_instance_id = ?",
    )
      .bind(CORR_ID)
      .first<{ can_delegate_to: string }>();
    const targets = JSON.parse(corrRow?.can_delegate_to ?? "[]") as Array<string>;
    expect(targets).toContain(member.id);
  });

  it("allows multi-hire of the same template with auto-numbered name", async () => {
    const first = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const second = await hireMember(env.DB, {
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    expect(first.displayName).toBe("Designer");
    expect(second.displayName).toBe("Designer #2");
    expect(second.id).not.toBe(first.id);
  });

  it("uses a provided displayName when present", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: "Marina",
      templateId: "tpl-designer",
    });
    expect(member.displayName).toBe("Marina");
  });

  it("writes MEMBER_HIRED activity row", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const row = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_HIRED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(row?.type).toBe("MEMBER_HIRED");
  });

  it("rejects unknown templates with a clear error", async () => {
    await expect(
      hireMember(env.DB, {
        companyId: COMPANY_ID,
        displayName: undefined,
        templateId: "tpl-nope",
      }),
    ).rejects.toThrow(/template.*tpl-nope/v);
  });
});

describe("pauseMember / resumeMember", () => {
  it("pauses a worker and writes activity", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const paused = await pauseMember(env.DB, COMPANY_ID, member.id);
    expect(paused.status).toBe("paused");
    const row = await env.DB.prepare("SELECT status FROM agent_instance WHERE id = ?")
      .bind(member.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("paused");
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PAUSED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_PAUSED");
  });

  it("resumes a paused worker", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await pauseMember(env.DB, COMPANY_ID, member.id);
    const resumed = await resumeMember(env.DB, COMPANY_ID, member.id);
    expect(resumed.status).toBe("available");
  });

  it("rejects pausing the correspondent", async () => {
    await expect(pauseMember(env.DB, COMPANY_ID, CORR_ID)).rejects.toThrow(/correspondent/v);
  });

  it("is idempotent (pausing twice returns paused without error)", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await pauseMember(env.DB, COMPANY_ID, member.id);
    const again = await pauseMember(env.DB, COMPANY_ID, member.id);
    expect(again.status).toBe("paused");
  });
});

describe("updateMember", () => {
  it("renames a worker", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: "Marina",
      editedBy: "customer",
      operatorId: null,
      promptOverride: undefined,
    });
    expect(updated.displayName).toBe("Marina");
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_RENAMED'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_RENAMED");
  });

  it("sets the prompt override and logs MEMBER_PROMPT_EDITED", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "operator",
      operatorId: "user-staff-1",
      promptOverride: "Seja minimalista, monocromático.",
    });
    expect(updated.hasPromptOverride).toBe(true);
    const log = await env.DB.prepare(
      "SELECT type, actor_id FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'",
    )
      .bind(member.id)
      .first<{ actor_id: string | null; type: string }>();
    expect(log).toEqual({ actor_id: "user-staff-1", type: "MEMBER_PROMPT_EDITED" });
  });

  it("clears the prompt override when promptOverride is null + logs MEMBER_PROMPT_RESET", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: "anything",
    });
    const cleared = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: null,
    });
    expect(cleared.hasPromptOverride).toBe(false);
    const log = await env.DB.prepare(
      "SELECT type FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_RESET'",
    )
      .bind(member.id)
      .first<{ type: string }>();
    expect(log?.type).toBe("MEMBER_PROMPT_RESET");
  });

  it("accepts both fields in one call", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    const updated = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: "Carla",
      editedBy: "customer",
      operatorId: null,
      promptOverride: "boa noite",
    });
    expect(updated.displayName).toBe("Carla");
    expect(updated.hasPromptOverride).toBe(true);
  });

  it("treats empty/whitespace promptOverride as a reset (does not store empty string)", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: undefined,
      templateId: "tpl-designer",
    });
    // First set it to something
    await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: "real prompt",
    });
    // Then send an empty string — should reset, not store ""
    const result = await updateMember(env.DB, {
      agentInstanceId: member.id,
      companyId: COMPANY_ID,
      displayName: undefined,
      editedBy: "customer",
      operatorId: null,
      promptOverride: "   ",
    });
    expect(result.hasPromptOverride).toBe(false);
    const row = await env.DB.prepare("SELECT prompt_override FROM agent_instance WHERE id = ?")
      .bind(member.id)
      .first<{ prompt_override: string | null }>();
    expect(row?.prompt_override).toBeNull();
  });

  it("rejects whitespace-only displayName at hire (mutation-layer defense)", async () => {
    const member = await hireMember(env.DB, {
      actorId: null,
      companyId: COMPANY_ID,
      displayName: "   ",
      templateId: "tpl-designer",
    });
    // Should fall back to nextDisplayName, not store "   "
    expect(member.displayName.trim().length).toBeGreaterThan(0);
  });
});
