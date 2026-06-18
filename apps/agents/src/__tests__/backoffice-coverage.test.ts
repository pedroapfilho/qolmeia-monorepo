import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proposeAction } from "@/db/action";
import { listCoverage, listDisciplines, setCoverage } from "@/db/assignment";

// ADR 0005 operator coverage: the cross-tenant approval queue narrows to the
// operator's assigned companies + disciplines (worker_kinds). No coverage means
// they see everything; an explicit ?companyId= drills past coverage.

const COMPANY_A = "co_cov_a";
const COMPANY_B = "co_cov_b";
const OPERATOR = "op-cov-1";
const originalFetch = globalThis.fetch;

const meStaff = {
  currentOrg: { id: "qolmeia-internal", role: "STAFF" },
  user: { id: OPERATOR },
};

const seedCompany = (id: string, name: string) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, ?, ?, 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  ).bind(id, name, name.toLowerCase().replace(/\s+/v, "-"));

beforeEach(async () => {
  await env.DB.batch([
    seedCompany(COMPANY_A, "Cov A"),
    seedCompany(COMPANY_B, "Cov B"),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-cov-designer', 1, 'active', 'Designer', 'd', 'P', 'm', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-cov-redator', 1, 'active', 'Redator', 'r', 'P', 'm', 'redator', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, created_at, updated_at)
       VALUES ('ai-cov-a', ?, 'worker', 'tpl-cov-designer', 1, 'D', NULL, 'active', 0, 0)`,
    ).bind(COMPANY_A),
    env.DB.prepare(
      `INSERT OR IGNORE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, created_at, updated_at)
       VALUES ('ai-cov-b', ?, 'worker', 'tpl-cov-redator', 1, 'R', NULL, 'active', 0, 0)`,
    ).bind(COMPANY_B),
    env.DB.prepare(
      `INSERT OR IGNORE INTO ticket (id, company_id, agent_instance_id, parent_ticket_id, title, brief, status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt-cov-a', ?, 'ai-cov-a', NULL, 't', 'b', 'awaiting_approval', 'delegation', NULL, NULL, 0, 0)`,
    ).bind(COMPANY_A),
    env.DB.prepare(
      `INSERT OR IGNORE INTO ticket (id, company_id, agent_instance_id, parent_ticket_id, title, brief, status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt-cov-b', ?, 'ai-cov-b', NULL, 't', 'b', 'awaiting_approval', 'delegation', NULL, NULL, 0, 0)`,
    ).bind(COMPANY_B),
  ]);
  await env.DB.prepare("DELETE FROM operator_assignment WHERE operator_user_id = ?")
    .bind(OPERATOR)
    .run();
  await proposeAction(env.DB, {
    actionType: "publish_post",
    companyId: COMPANY_A,
    policy: "require-approval",
    proposed: { summary: "A" },
    ticketId: "tkt-cov-a",
  });
  await proposeAction(env.DB, {
    actionType: "publish_post",
    companyId: COMPANY_B,
    policy: "require-approval",
    proposed: { summary: "B" },
    ticketId: "tkt-cov-b",
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const pendingCompanyIds = async (query = ""): Promise<Array<string>> => {
  const res = await SELF.fetch(
    `https://agents.test/api/backoffice/actions?status=pending&cf_session=covtok${query}`,
  );
  const body = (await res.json()) as { items: Array<{ companyId: string }> };
  return body.items.map((a) => a.companyId);
};

describe("operator coverage DB", () => {
  it("setCoverage replaces; listCoverage round-trips; listDisciplines covers templates", async () => {
    await setCoverage(env.DB, OPERATOR, { companies: [COMPANY_A], disciplines: ["designer"] });
    let coverage = await listCoverage(env.DB, OPERATOR);
    expect(coverage.companies).toEqual([COMPANY_A]);
    expect(coverage.disciplines).toEqual(["designer"]);

    // A second set fully replaces — not appends.
    await setCoverage(env.DB, OPERATOR, { companies: [], disciplines: ["redator"] });
    coverage = await listCoverage(env.DB, OPERATOR);
    expect(coverage.companies).toEqual([]);
    expect(coverage.disciplines).toEqual(["redator"]);

    const disciplines = await listDisciplines(env.DB);
    expect(disciplines).toContain("designer");
    expect(disciplines).toContain("redator");
  });
});

describe("GET/PUT /api/backoffice/assignments/me", () => {
  it("returns empty coverage + option lists, then reflects a PUT", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const before = await SELF.fetch(
      "https://agents.test/api/backoffice/assignments/me?cf_session=covtok",
    );
    const beforeBody = (await before.json()) as {
      assigned: { companies: Array<string>; disciplines: Array<string> };
      options: { companies: Array<{ id: string }>; disciplines: Array<string> };
    };
    expect(beforeBody.assigned.companies).toEqual([]);
    expect(beforeBody.options.companies.some((co) => co.id === COMPANY_A)).toBe(true);
    expect(beforeBody.options.disciplines).toContain("designer");

    const put = await SELF.fetch(
      "https://agents.test/api/backoffice/assignments/me?cf_session=covtok",
      {
        body: JSON.stringify({ companies: [COMPANY_A], disciplines: [] }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(put.status).toBe(200);
    const after = await SELF.fetch(
      "https://agents.test/api/backoffice/assignments/me?cf_session=covtok",
    );
    const afterBody = (await after.json()) as { assigned: { companies: Array<string> } };
    expect(afterBody.assigned.companies).toEqual([COMPANY_A]);
  });
});

describe("approval queue narrows to coverage", () => {
  it("no coverage = sees every company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const ids = await pendingCompanyIds();
    expect(ids).toContain(COMPANY_A);
    expect(ids).toContain(COMPANY_B);
  });

  it("company coverage filters the queue to that company", async () => {
    await setCoverage(env.DB, OPERATOR, { companies: [COMPANY_A], disciplines: [] });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const ids = await pendingCompanyIds();
    expect(ids).toContain(COMPANY_A);
    expect(ids).not.toContain(COMPANY_B);
  });

  it("discipline coverage filters by the producing agent's worker_kind", async () => {
    await setCoverage(env.DB, OPERATOR, { companies: [], disciplines: ["redator"] });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const ids = await pendingCompanyIds();
    // Only company B has a redator-produced action.
    expect(ids).toContain(COMPANY_B);
    expect(ids).not.toContain(COMPANY_A);
  });

  it("explicit ?companyId= drills past coverage", async () => {
    await setCoverage(env.DB, OPERATOR, { companies: [COMPANY_A], disciplines: [] });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const ids = await pendingCompanyIds(`&companyId=${COMPANY_B}`);
    expect(ids).toContain(COMPANY_B);
    expect(ids).not.toContain(COMPANY_A);
  });
});
