import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_bot_test";
const originalFetch = globalThis.fetch;

const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};
const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "user-1" },
};

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
       VALUES (?, 'BT', 'bt', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
    env.DB.prepare(
      `INSERT OR REPLACE INTO template (id, version, status, display_name, description, system_prompt, model, worker_kind, skill_ids, default_action_type, default_policies, created_at, updated_at)
       VALUES ('tpl-designer', 1, 'active', 'Designer', 'd', 'TPL_PROMPT', 'gpt-x', 'designer', '[]', 'worker_deliverable', '{}', 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO agent_instance (id, company_id, role, template_id, template_version, display_name, model_override, status, prompt_override, created_at, updated_at)
       VALUES ('ai_bot_d', ?, 'worker', 'tpl-designer', 1, 'Designer', NULL, 'active', NULL, 0, 0)`,
    ).bind(COMPANY_ID),
  ]);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("/api/backoffice/teams/:companyId/members", () => {
  it("lists members for STAFF", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members?cf_session=tok`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<{ id: string }> }>();
    expect(body.members.some((m) => m.id === "ai_bot_d")).toBe(true);
  });

  it("403 for CUSTOMER", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members?cf_session=tok`,
    );
    expect(res.status).toBe(403);
  });

  it("GET member detail returns templateSystemPrompt and promptOverride", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      member: { promptOverride: string | null; templateSystemPrompt: string };
    }>();
    expect(body.member.templateSystemPrompt).toBe("TPL_PROMPT");
    expect(body.member.promptOverride).toBeNull();
  });

  it("PATCH member updates promptOverride and writes operator-tagged activity", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`,
      {
        body: JSON.stringify({ promptOverride: "novo prompt" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(200);
    const log = await env.DB.prepare(
      "SELECT actor_id, payload FROM activity_log WHERE ref_id = 'ai_bot_d' AND type = 'MEMBER_PROMPT_EDITED'",
    ).first<{ actor_id: string; payload: string }>();
    expect(log?.actor_id).toBe("staff-1");
    expect(JSON.parse(log?.payload ?? "{}").editedBy).toBe("operator");
  });
});

describe("backoffice team routes — cross-tenant", () => {
  it("STAFF queries another company's members list (empty when it has none)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/co_other_company/members?cf_session=tok`,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ members: Array<{ id: string }> }>();
    expect(body.members).toEqual([]);
  });

  it("404 (not 403) when STAFF reads a member that doesn't exist in that company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/co_other_company/members/ai_bot_d?cf_session=tok`,
    );
    expect(res.status).toBe(404);
  });

  it("404 (not 403) when STAFF PATCHes a member that doesn't exist in that company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/co_other_company/members/ai_bot_d?cf_session=tok`,
      {
        body: JSON.stringify({ displayName: "evil" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/backoffice/companies", () => {
  it("returns every company with its roster + brief completeness for STAFF", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/companies?cf_session=tok",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      companies: Array<{ briefPercent: number; id: string; members: Array<{ id: string }> }>;
    }>();
    const co = body.companies.find((c) => c.id === COMPANY_ID);
    expect(co).toBeDefined();
    expect(typeof co?.briefPercent).toBe("number");
    expect(co?.members.some((m) => m.id === "ai_bot_d")).toBe(true);
  });

  it("403 for CUSTOMER", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/companies?cf_session=tok",
    );
    expect(res.status).toBe(403);
  });
});

describe("backoffice member detail extras + pause/resume", () => {
  it("member detail exposes companyName and createdAt", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`,
    );
    const body = await res.json<{ member: { companyName: string; createdAt: number } }>();
    expect(body.member.companyName).toBe("BT");
    expect(typeof body.member.createdAt).toBe("number");
  });

  it("PATCH status pauses then resumes a worker", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const url = `https://agents.test/api/backoffice/teams/${COMPANY_ID}/members/ai_bot_d?cf_session=tok`;
    const headers = { "content-type": "application/json" };

    const pause = await exports.default.fetch(url, {
      body: JSON.stringify({ status: "paused" }),
      headers,
      method: "PATCH",
    });
    expect(pause.status).toBe(200);
    const pauseBody = await pause.json<{ member: { status: string } }>();
    expect(pauseBody.member.status).toBe("paused");
    const row = await env.DB.prepare(
      "SELECT status FROM agent_instance WHERE id = 'ai_bot_d'",
    ).first<{ status: string }>();
    expect(row?.status).toBe("paused");

    const resume = await exports.default.fetch(url, {
      body: JSON.stringify({ status: "active" }),
      headers,
      method: "PATCH",
    });
    expect(resume.status).toBe(200);
    const resumeBody = await resume.json<{ member: { status: string } }>();
    expect(resumeBody.member.status).toBe("available");
  });
});
