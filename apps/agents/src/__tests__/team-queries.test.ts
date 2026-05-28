import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getTeamRoster } from "@/team/queries";

const COMPANY_ID = "co_roster_test";
const TEAM_ID = "team_roster_test";
const CORR_ID = "corr_roster_test";
const WORKER_ID = "worker_roster_test";

beforeEach(async () => {
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
});
