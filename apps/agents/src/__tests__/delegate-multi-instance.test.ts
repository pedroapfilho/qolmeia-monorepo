import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { delegateToWorkerSkill } from "@/skills/delegate-to-worker";
import type { SkillContext } from "@/skills/registry";

const COMPANY_ID = "co_multi_test";
const CORR_ID = `corr-${COMPANY_ID}`;
const D1 = "wkr_multi_1";
const D2 = "wkr_multi_2";

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ticket WHERE company_id = ?`).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'M', 'm', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'sys', 'gpt-x', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'correspondent', NULL, NULL, 'C', NULL, 'active', NULL, 0, 0)`,
    ).bind(CORR_ID, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'D1', NULL, 'active', NULL, 0, 0)`,
    ).bind(D1, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES (?, ?, 'worker', 'tpl-designer', 1, 'D2', NULL, 'active', NULL, 0, 0)`,
    ).bind(D2, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR IGNORE INTO team (id, company_id, confirmed_at, created_at) VALUES (?, ?, 0, 0)`,
    ).bind(`team-${COMPANY_ID}`, COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, ?)`,
    ).bind(`team-${COMPANY_ID}`, CORR_ID, JSON.stringify([D1, D2])),
    env.DB.prepare(
      `INSERT OR REPLACE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(`team-${COMPANY_ID}`, D1),
    env.DB.prepare(
      `INSERT OR REPLACE INTO team_member (team_id, agent_instance_id, can_delegate_to) VALUES (?, ?, '[]')`,
    ).bind(`team-${COMPANY_ID}`, D2),
  ]);
});

const ctx: SkillContext = {
  agentInstanceId: CORR_ID,
  companyId: COMPANY_ID,
  get env() {
    return env;
  },
};

describe("delegateToWorker multi-instance dispatch", () => {
  it("prefers an available worker over one that's busy", async () => {
    // D1 is busy (has an in_progress ticket); D2 is available.
    await env.DB.prepare(
      `INSERT INTO ticket (id, company_id, agent_instance_id, parent_ticket_id, title, brief, status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt_busy', ?, ?, NULL, 't', 'b', 'in_progress', 'delegation', NULL, NULL, 0, 0)`,
    )
      .bind(COMPANY_ID, D1)
      .run();

    const result = (await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    )) as { error?: string; status?: string };
    expect("status" in result && result.status).toBe("queued");
    // Inspect the freshly-created ticket to confirm it was assigned to D2
    const tickets = await env.DB.prepare(
      "SELECT agent_instance_id FROM ticket WHERE company_id = ? AND title LIKE 'designer:%'",
    )
      .bind(COMPANY_ID)
      .all<{ agent_instance_id: string }>();
    expect(tickets.results.some((r) => r.agent_instance_id === D2)).toBe(true);
    expect(tickets.results.some((r) => r.agent_instance_id === D1)).toBe(false);
  });

  it("skips paused workers entirely", async () => {
    await env.DB.prepare("UPDATE agent_instance SET status = 'paused' WHERE id = ?").bind(D2).run();
    const result = (await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    )) as { error?: string; status?: string };
    expect("status" in result && result.status).toBe("queued");
    const tickets = await env.DB.prepare(
      "SELECT agent_instance_id FROM ticket WHERE company_id = ? AND title LIKE 'designer:%'",
    )
      .bind(COMPANY_ID)
      .all<{ agent_instance_id: string }>();
    // Should land on D1 (the only active one), even though it's busy.
    expect(tickets.results.every((r) => r.agent_instance_id !== D2)).toBe(true);
  });

  it("returns an error when all workers of the kind are paused", async () => {
    await env.DB.prepare(
      "UPDATE agent_instance SET status = 'paused' WHERE template_id = 'tpl-designer'",
    ).run();
    const result = (await delegateToWorkerSkill.execute(
      { brief: "fazer logo", workerKind: "designer" },
      ctx,
    )) as { error?: string; status?: string };
    expect("error" in result).toBe(true);
  });
});
