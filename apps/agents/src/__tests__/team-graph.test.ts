import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { getDelegationTargets, isAcyclic, materializeTeam } from "#/db/team";

const COMPANY_ID = "co_team_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Team Test', 'team-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO template
       (id, worker_kind, display_name, description, system_prompt, model,
        skill_ids, default_policies, status, version, created_at, updated_at)
     VALUES ('tpl-designer-test', 'designer', 'Designer', 'd', 'sys', 'openai/gpt-5.4-nano',
             '[]', '{}', 'active', 1, 0, 0)`,
  ).run();
});

describe("isAcyclic", () => {
  it("returns true for a DAG", () => {
    const g = new Map<string, Array<string>>([
      ["A", ["B", "C"]],
      ["B", ["D"]],
      ["C", ["D"]],
      ["D", []],
    ]);
    expect(isAcyclic(g)).toBe(true);
  });

  it("returns false for a cycle", () => {
    const g = new Map<string, Array<string>>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    expect(isAcyclic(g)).toBe(false);
  });

  it("returns true for a single self-loop-free leaf", () => {
    const g = new Map<string, Array<string>>([["A", []]]);
    expect(isAcyclic(g)).toBe(true);
  });
});

describe("materializeTeam", () => {
  it("inserts team + correspondent + workers + team_member rows atomically", async () => {
    const result = await materializeTeam(env.DB, {
      companyId: COMPANY_ID,
      templateIds: ["tpl-designer-test"],
    });
    expect(result.correspondentId).toBe(`corr-${COMPANY_ID}`);
    expect(result.workerIds).toEqual([`worker-tpl-designer-test-${COMPANY_ID}`]);

    const team = await env.DB.prepare("SELECT id FROM team WHERE company_id = ?")
      .bind(COMPANY_ID)
      .first<{ id: string }>();
    expect(team?.id).toBe(result.teamId);

    const { results: instances } = await env.DB.prepare(
      "SELECT id, role FROM agent_instance WHERE company_id = ? ORDER BY role",
    )
      .bind(COMPANY_ID)
      .all<{ id: string; role: string }>();
    expect(instances.map((r) => r.role)).toEqual(["correspondent", "worker"]);
  });

  it("is idempotent — re-running with the same templateIds doesn't duplicate", async () => {
    await materializeTeam(env.DB, {
      companyId: COMPANY_ID,
      templateIds: ["tpl-designer-test"],
    });
    await materializeTeam(env.DB, {
      companyId: COMPANY_ID,
      templateIds: ["tpl-designer-test"],
    });
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM agent_instance WHERE company_id = ?",
    )
      .bind(COMPANY_ID)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(2);
  });

  it("rejects unknown templates", async () => {
    await expect(
      materializeTeam(env.DB, {
        companyId: COMPANY_ID,
        templateIds: ["tpl-does-not-exist"],
      }),
    ).rejects.toThrow(/not found/v);
  });

  it("populates can_delegate_to so Correspondent → Designer is allowed", async () => {
    const result = await materializeTeam(env.DB, {
      companyId: COMPANY_ID,
      templateIds: ["tpl-designer-test"],
    });
    const targets = await getDelegationTargets(env.DB, result.correspondentId);
    expect(targets).toEqual(result.workerIds);
    const workerTargets = await getDelegationTargets(env.DB, result.workerIds[0] ?? "");
    expect(workerTargets).toEqual([]);
  });
});
