import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_confirm_test";
const ORIGINAL_FETCH = globalThis.fetch;

const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "cust-1" },
};
const meOtherOrg = {
  currentOrg: { id: "co_other", role: "CUSTOMER" },
  user: { id: "cust-2" },
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Confirm Test', 'confirm-test', 'America/Sao_Paulo', 'pt-BR', 'onboarding', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company_template_entitlement
       (company_id, template_id, enabled, created_at, updated_at)
     VALUES (?, 'tpl-designer', 1, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("POST /api/teams/:companyId/confirm", () => {
  it("rejects unauthenticated with 401", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    const res = await exports.default.fetch(`https://agents.test/api/teams/${COMPANY_ID}/confirm`, {
      body: JSON.stringify({ templateIds: ["tpl-designer"] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("rejects a confirm for a different org with 403", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meOtherOrg)));
    const res = await exports.default.fetch(
      `https://agents.test/api/teams/${COMPANY_ID}/confirm?cf_session=tok`,
      {
        body: JSON.stringify({ templateIds: ["tpl-designer"] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid body (empty templateIds)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      `https://agents.test/api/teams/${COMPANY_ID}/confirm?cf_session=tok`,
      {
        body: JSON.stringify({ templateIds: [] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(res.status).toBe(400);
  });

  it("materializes the team and flips company status to active", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      `https://agents.test/api/teams/${COMPANY_ID}/confirm?cf_session=tok`,
      {
        body: JSON.stringify({ templateIds: ["tpl-designer"] }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ team: { correspondentId: string; teamId: string } }>();
    expect(body.team.correspondentId).toBe(`corr-${COMPANY_ID}`);

    const company = await env.DB.prepare("SELECT status FROM company WHERE id = ?")
      .bind(COMPANY_ID)
      .first<{ status: string }>();
    expect(company?.status).toBe("active");
  });
});
