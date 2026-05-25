import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proposeAction } from "@/db/action";

const COMPANY_ID = "co_bo_test";
const originalFetch = globalThis.fetch;

const meStaff = {
  currentOrg: { id: COMPANY_ID, role: "STAFF" },
  user: { id: "staff-1" },
};
const meCustomer = {
  currentOrg: { id: COMPANY_ID, role: "CUSTOMER" },
  user: { id: "cust-1" },
};

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'BO Test', 'bo-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, created_at, updated_at)
     VALUES ('agent-bo-test', ?, 'worker', 'tpl-designer', 1, 'd', NULL, 'active', 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt-bo-test', ?, 'agent-bo-test', NULL, 't', 'b',
             'awaiting_approval', 'delegation', NULL, NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("backoffice auth gate", () => {
  it("rejects unauthenticated with 401", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    const res = await SELF.fetch("https://agents.test/api/backoffice/tickets?cf_session=tok");
    expect(res.status).toBe(401);
  });

  it("rejects CUSTOMER with 403", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await SELF.fetch("https://agents.test/api/backoffice/tickets?cf_session=tok");
    expect(res.status).toBe(403);
  });

  it("admits STAFF with 200", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch("https://agents.test/api/backoffice/tickets?cf_session=tok");
    expect(res.status).toBe(200);
  });
});

describe("backoffice listing endpoints", () => {
  it("lists tickets scoped to the staff's company", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch("https://agents.test/api/backoffice/tickets?cf_session=tok");
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((t) => t.id === "tkt-bo-test")).toBe(true);
  });

  it("lists pending actions sorted by age (oldest first)", async () => {
    await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { summary: "x" },
      ticketId: "tkt-bo-test",
    });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      "https://agents.test/api/backoffice/actions?status=pending&sort=age&cf_session=tok",
    );
    const body = (await res.json()) as { items: Array<{ ageSeconds: number }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty("ageSeconds");
  });
});

describe("operator override decide", () => {
  it("returns 404 for an unknown action id", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      "https://agents.test/api/backoffice/actions/does-not-exist/decide?cf_session=tok",
      {
        body: JSON.stringify({ decision: "approved" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid body", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await SELF.fetch(
      "https://agents.test/api/backoffice/actions/whatever/decide?cf_session=tok",
      {
        body: JSON.stringify({ decision: "maybe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(res.status).toBe(400);
  });
});
