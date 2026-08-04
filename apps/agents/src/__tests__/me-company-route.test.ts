import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "co_mecompany_test";
const originalFetch = globalThis.fetch;

const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "user-1" },
};
const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};

type CompanyBody = {
  company: { brief: Record<string, unknown>; status: string };
  completeness: { isComplete: boolean; missing: Array<string>; percent: number };
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO company (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'MC', 'mc', 'America/Sao_Paulo', 'pt-BR', 'onboarding', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/me/company", () => {
  it("returns an empty brief with 0% completeness", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok");
    expect(res.status).toBe(200);
    const body = await res.json<CompanyBody>();
    expect(body.completeness.percent).toBe(0);
    expect(body.completeness.isComplete).toBe(false);
  });
});

describe("a multi-org client that named no org", () => {
  it("gets 400 with the org list, not a 401 that would send it back to login", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          currentOrg: null,
          orgs: [
            { id: "co_a", name: "A", role: "CUSTOMER" },
            { id: "co_b", name: "B", role: "CUSTOMER" },
          ],
          user: { id: "user-1" },
        }),
      ),
    );

    const res = await exports.default.fetch(
      "https://agents.test/api/me/company?cf_session=ambiguous-tok",
    );

    expect(res.status).toBe(400);
    const body = await res.json<{ error: string; orgs: ReadonlyArray<{ id: string }> }>();
    expect(body.error).toBe("org_required");
    expect(body.orgs.map((org) => org.id)).toEqual(["co_a", "co_b"]);
  });
});

describe("PATCH /api/me/company", () => {
  it("merges a partial brief and recomputes completeness", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok", {
      body: JSON.stringify({ industry: "alimentação" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const body = await res.json<CompanyBody>();
    expect(body.company.brief.industry).toBe("alimentação");
    expect(body.completeness.missing).toContain("primaryGoal");
    expect(body.completeness.percent).toBe(17);
  });

  it("preserves earlier fields across successive patches", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok", {
      body: JSON.stringify({ industry: "alimentação" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const res = await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok", {
      body: JSON.stringify({ primaryGoal: "vender mais" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const body = await res.json<CompanyBody>();
    expect(body.company.brief.industry).toBe("alimentação");
    expect(body.company.brief.primaryGoal).toBe("vender mais");
  });

  it("403 when STAFF tries to edit the brief", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok", {
      body: JSON.stringify({ industry: "x" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(res.status).toBe(403);
  });

  it("400 on an invalid body", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch("https://agents.test/api/me/company?cf_session=tok", {
      body: JSON.stringify({ channels: ["not-a-channel"] }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(res.status).toBe(400);
  });
});
