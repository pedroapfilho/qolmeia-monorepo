import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getCatalogue, getMemberDetail, getTeamRoster, listTeamRosters } from "#/team/queries";

const COMPANY_ID = "co_roster_test";
const TEAM_ID = "team_roster_test";
const CORR_ID = "corr_roster_test";
const WORKER_ID = "worker_roster_test";
const OTHER_COMPANY_ID = "co_roster_other";
const OTHER_WORKER_ID = "worker_roster_other";

const entitle = (companyId: string, templateId: string) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO company_template_entitlement
       (company_id, template_id, enabled, created_at, updated_at)
     VALUES (?, ?, 1, 0, 0)`,
  )
    .bind(companyId, templateId)
    .run();

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM company_template_entitlement WHERE company_id IN (?, ?)").bind(
      COMPANY_ID,
      OTHER_COMPANY_ID,
    ),
    env.DB.prepare("DELETE FROM agent_instance WHERE id = 'worker_no_tpl'"),
    env.DB.prepare("DELETE FROM template WHERE id = 'tpl-entitled-only'"),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'R', 'r', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'Correspondente', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'Designer', NULL, 'active', 'meu', 0, 0)`,
    ).bind(WORKER_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO company
         (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'Other', 'other', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(OTHER_COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'Outro Designer', NULL, 'active', NULL, 0, 0)`,
    ).bind(OTHER_WORKER_ID, OTHER_COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(TEAM_ID, COMPANY_ID, 0, 0),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, ?)`,
    ).bind(TEAM_ID, CORR_ID, JSON.stringify([WORKER_ID])),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(TEAM_ID, WORKER_ID),
  ]);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt_r1', ?, ?, NULL, 'Logo final', 'fazer logo', 'in_progress',
             'delegation', NULL, NULL, 0, 0)`,
  )
    .bind(COMPANY_ID, WORKER_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt_r2', ?, ?, NULL, 'Banner antigo', 'feito', 'done',
             'delegation', NULL, '{}', 0, 0)`,
  )
    .bind(COMPANY_ID, WORKER_ID)
    .run();
});

describe("getTeamRoster", () => {
  it("returns the correspondent and worker with derived status + current work + counts", async () => {
    const roster = await getTeamRoster(env.DB, COMPANY_ID);
    const designer = roster.find((m) => m.id === WORKER_ID);
    const correspondent = roster.find((m) => m.id === CORR_ID);

    expect(correspondent).toMatchObject({
      displayName: "Correspondente",
      hasPromptOverride: false,
      role: "correspondent",
      status: "available",
      templateId: null,
      workerKind: null,
    });

    expect(designer).toMatchObject({
      displayName: "Designer",
      hasPromptOverride: true,
      lifetimeDone: 1,
      role: "worker",
      status: "working",
      templateId: "tpl-designer",
      workerKind: "designer",
    });
    expect(designer?.currentWork).toEqual([
      { status: "in_progress", summary: "Logo final", ticketId: "tkt_r1" },
    ]);
  });

  it("orders correspondent first, then by recent activity, then alphabetical", async () => {
    const roster = await getTeamRoster(env.DB, COMPANY_ID);
    expect(roster[0]?.role).toBe("correspondent");
  });

  it("throws if a worker row is missing template_id (data corruption guard)", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance
         (id, company_id, role, template_id, template_version, display_name,
          model_override, status, prompt_override, created_at, updated_at)
       VALUES ('worker_no_tpl', ?, 'worker', NULL, NULL, 'broken', NULL, 'active', NULL, 0, 0)`,
    )
      .bind(COMPANY_ID)
      .run();
    await expect(getTeamRoster(env.DB, COMPANY_ID)).rejects.toThrow(/worker .* missing/v);
  });

  it("loads multiple company rosters without mixing work", async () => {
    const rosters = await listTeamRosters(env.DB, [COMPANY_ID, OTHER_COMPANY_ID]);

    expect(rosters.get(COMPANY_ID)?.some((m) => m.id === WORKER_ID)).toBe(true);
    expect(rosters.get(COMPANY_ID)?.some((m) => m.id === OTHER_WORKER_ID)).toBe(false);
    expect(rosters.get(OTHER_COMPANY_ID)?.map((m) => m.id)).toEqual([OTHER_WORKER_ID]);
  });
});

describe("getCatalogue", () => {
  it("returns active worker templates with per-template hiredCount for this company", async () => {
    await entitle(COMPANY_ID, "tpl-designer");
    const items = await getCatalogue(env.DB, COMPANY_ID);
    const designer = items.find((t) => t.id === "tpl-designer");
    expect(designer).toMatchObject({
      hiredCount: 1,
      workerKind: "designer",
    });
  });

  it("returns 0 for templates with no hires on this company", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-fresh', 1, 'active', 'Novo Tipo', 'desc', 'sys', 'gpt-x',
               'newkind', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ).run();
    await entitle(COMPANY_ID, "tpl-fresh");
    const items = await getCatalogue(env.DB, COMPANY_ID);
    expect(items.find((t) => t.id === "tpl-fresh")?.hiredCount).toBe(0);
  });

  it("returns only templates the company is entitled to", async () => {
    const now = Date.now();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-entitled-only', 1, 'active', 'Entitled', 'desc', 'sys', 'gpt-x',
               'entitled', '[]', 'worker_deliverable', '{}', ?, ?)`,
    )
      .bind(now, now)
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO company_template_entitlement
         (company_id, template_id, enabled, created_at, updated_at)
       VALUES (?, 'tpl-entitled-only', 1, ?, ?)`,
    )
      .bind(COMPANY_ID, now, now)
      .run();

    const items = await getCatalogue(env.DB, COMPANY_ID);

    expect(items.map((item) => item.id)).toEqual(["tpl-entitled-only"]);
  });
});

describe("getMemberDetail", () => {
  it("returns the template prompt and override + last edited timestamp", async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO template
         (id, version, status, display_name, description, system_prompt, model,
          worker_kind, skill_ids, default_action_type, default_policies,
          created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'cria imagens',
               'TEMPLATE_PROMPT', 'gpt-x', 'designer', '[]',
               'worker_deliverable', '{}', 0, 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO activity_log
         (id, company_id, actor_id, type, ref_type, ref_id, summary, payload, created_at)
       VALUES ('al_pe', ?, NULL, 'MEMBER_PROMPT_EDITED', 'agent_instance', ?, 'edited', '{}', 1234)`,
    )
      .bind(COMPANY_ID, WORKER_ID)
      .run();

    const detail = await getMemberDetail(env.DB, COMPANY_ID, WORKER_ID);
    expect(detail).toMatchObject({
      capabilities: "cria imagens",
      hasPromptOverride: true,
      id: WORKER_ID,
      promptOverride: "meu",
      promptOverrideUpdatedAt: 1234,
      templateSystemPrompt: "TEMPLATE_PROMPT",
    });
  });

  it("returns null promptOverrideUpdatedAt when no edit log row exists", async () => {
    await env.DB.prepare("UPDATE agent_instance SET prompt_override = NULL WHERE id = ?")
      .bind(WORKER_ID)
      .run();
    await env.DB.prepare(
      "DELETE FROM activity_log WHERE ref_id = ? AND type = 'MEMBER_PROMPT_EDITED'",
    )
      .bind(WORKER_ID)
      .run();
    const detail = await getMemberDetail(env.DB, COMPANY_ID, WORKER_ID);
    expect(detail?.hasPromptOverride).toBe(false);
    expect(detail?.promptOverride).toBeNull();
    expect(detail?.promptOverrideUpdatedAt).toBeNull();
  });

  it("returns null when the instance doesn't belong to that company", async () => {
    const detail = await getMemberDetail(env.DB, "co_other", WORKER_ID);
    expect(detail).toBeNull();
  });
});
