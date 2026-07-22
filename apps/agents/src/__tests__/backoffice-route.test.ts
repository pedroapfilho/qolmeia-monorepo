import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logActivity } from "#/activity/log";
import { proposeAction } from "#/db/action";

const COMPANY_ID = "co_bo_test";
const OTHER_COMPANY_ID = "co_bo_other";
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

  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'BO Other', 'bo-other', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(OTHER_COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, created_at, updated_at)
     VALUES ('agent-bo-other', ?, 'worker', 'tpl-designer', 1, 'd', NULL, 'active', 0, 0)`,
  )
    .bind(OTHER_COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt-bo-other', ?, 'agent-bo-other', NULL, 't', 'b',
             'awaiting_approval', 'delegation', NULL, NULL, 0, 0)`,
  )
    .bind(OTHER_COMPANY_ID)
    .run();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("backoffice auth gate", () => {
  it("rejects unauthenticated with 401", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response("Unauthorized", { status: 401 })));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?cf_session=tok",
    );
    expect(res.status).toBe(401);
  });

  it("rejects CUSTOMER with 403", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meCustomer)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?cf_session=tok",
    );
    expect(res.status).toBe(403);
  });

  it("admits STAFF with 200", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?cf_session=tok",
    );
    expect(res.status).toBe(200);
  });
});

describe("backoffice listing endpoints", () => {
  it("lists tickets across all tenants (camelCase shape + company label)", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?cf_session=tok",
    );
    const body = await res.json<{
      items: Array<{
        agentInstanceId: string;
        companyId: string;
        companyName: string;
        createdAt: number;
        id: string;
        origin: string;
        title: string;
      }>;
    }>();
    const ticket = body.items.find((t) => t.id === "tkt-bo-test");
    expect(ticket).toBeTruthy();
    expect(ticket?.agentInstanceId).toBe("agent-bo-test");
    expect(ticket?.companyId).toBe(COMPANY_ID);
    expect(ticket?.companyName).toBe("BO Test");
    expect(ticket?.origin).toBe("delegation");
    expect(typeof ticket?.createdAt).toBe("number");
    expect(ticket).not.toHaveProperty("agent_instance_id");
    expect(ticket).not.toHaveProperty("created_at");
    expect(body.items.find((t) => t.id === "tkt-bo-other")).toBeTruthy();
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
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/actions?status=pending&sort=age&cf_session=tok",
    );
    const body = await res.json<{
      items: Array<{ actionType: string; ageSeconds: number }>;
    }>();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty("ageSeconds");
    expect(body.items[0]?.actionType).toBe("worker_deliverable");
  });

  it("lists ALL actions (no status filter) in camelCase", async () => {
    await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { summary: "y" },
      ticketId: "tkt-bo-test",
    });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
      "https://agents.test/api/backoffice/actions?cf_session=tok",
    );
    const body = await res.json<{
      items: Array<{
        actionType: string;
        companyId: string;
        createdAt: number;
        id: string;
        ticketId: string;
      }>;
    }>();
    expect(body.items.length).toBeGreaterThan(0);
    const item = body.items[0];
    expect(item?.actionType).toBeTruthy();
    expect(item?.companyId).toBe(COMPANY_ID);
    expect(typeof item?.createdAt).toBe("number");
    expect(item).not.toHaveProperty("action_type");
    expect(item).not.toHaveProperty("company_id");
    expect(item).not.toHaveProperty("ticket_id");
  });
});

describe("backoffice list routes span tenants and honor the ?companyId= filter", () => {
  it("GET /tickets?companyId= narrows to that company; unfiltered spans all", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const filtered = await exports.default.fetch(
      `https://agents.test/api/backoffice/tickets?companyId=${OTHER_COMPANY_ID}&cf_session=tok`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json<{
      items: Array<{ companyId: string; id: string }>;
    }>();
    expect(filteredBody.items.find((t) => t.id === "tkt-bo-other")).toBeTruthy();
    expect(filteredBody.items.every((t) => t.companyId === OTHER_COMPANY_ID)).toBe(true);

    const all = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?cf_session=tok",
    );
    const allBody = await all.json<{ items: Array<{ id: string }> }>();
    expect(allBody.items.find((t) => t.id === "tkt-bo-test")).toBeTruthy();
    expect(allBody.items.find((t) => t.id === "tkt-bo-other")).toBeTruthy();
  });

  it("GET /actions?companyId= narrows to that company; unfiltered spans all", async () => {
    await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { summary: "mine" },
      ticketId: "tkt-bo-test",
    });
    await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: OTHER_COMPANY_ID,
      policy: "require-approval",
      proposed: { summary: "theirs" },
      ticketId: "tkt-bo-other",
    });
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const filtered = await exports.default.fetch(
      `https://agents.test/api/backoffice/actions?companyId=${OTHER_COMPANY_ID}&cf_session=tok`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json<{ items: Array<{ companyId: string }> }>();
    expect(filteredBody.items.length).toBeGreaterThan(0);
    expect(filteredBody.items.every((a) => a.companyId === OTHER_COMPANY_ID)).toBe(true);

    const all = await exports.default.fetch(
      "https://agents.test/api/backoffice/actions?cf_session=tok",
    );
    const allBody = await all.json<{ items: Array<{ companyId: string }> }>();
    expect(allBody.items.some((a) => a.companyId === COMPANY_ID)).toBe(true);
    expect(allBody.items.some((a) => a.companyId === OTHER_COMPANY_ID)).toBe(true);
  });

  it("GET /activity?companyId= narrows to that company; unfiltered spans all", async () => {
    await logActivity(
      { DB: env.DB },
      {
        companyId: COMPANY_ID,
        refId: "tkt-bo-test",
        refType: "ticket",
        summary: "mine",
        type: "TICKET_DONE",
      },
    );
    await logActivity(
      { DB: env.DB },
      {
        companyId: OTHER_COMPANY_ID,
        refId: "tkt-bo-other",
        refType: "ticket",
        summary: "theirs",
        type: "TICKET_DONE",
      },
    );
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const filtered = await exports.default.fetch(
      `https://agents.test/api/backoffice/activity?companyId=${OTHER_COMPANY_ID}&cf_session=tok`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json<{ items: Array<{ companyId: string }> }>();
    expect(filteredBody.items.length).toBeGreaterThan(0);
    expect(filteredBody.items.every((a) => a.companyId === OTHER_COMPANY_ID)).toBe(true);

    const all = await exports.default.fetch(
      "https://agents.test/api/backoffice/activity?cf_session=tok",
    );
    const allBody = await all.json<{ items: Array<{ companyId: string }> }>();
    expect(allBody.items.some((a) => a.companyId === COMPANY_ID)).toBe(true);
    expect(allBody.items.some((a) => a.companyId === OTHER_COMPANY_ID)).toBe(true);
  });
});

describe("backoffice list query-param hardening", () => {
  it("GET /tickets ignores a non-numeric limit and clamps an oversized one", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));

    const nonNumeric = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?limit=abc&cf_session=tok",
    );
    expect(nonNumeric.status).toBe(200);
    const nonNumericBody = await nonNumeric.json<{ items: Array<{ id: string }> }>();
    expect(nonNumericBody.items.find((t) => t.id === "tkt-bo-test")).toBeTruthy();

    const oversized = await exports.default.fetch(
      "https://agents.test/api/backoffice/tickets?limit=999999&cf_session=tok",
    );
    expect(oversized.status).toBe(200);
    const oversizedBody = await oversized.json<{ items: Array<{ id: string }> }>();
    expect(oversizedBody.items.find((t) => t.id === "tkt-bo-test")).toBeTruthy();
  });

  it("GET /activity ignores non-numeric limit, since, and before", async () => {
    await logActivity(
      { DB: env.DB },
      {
        companyId: COMPANY_ID,
        refId: "tkt-bo-test",
        refType: "ticket",
        summary: "hardening",
        type: "TICKET_DONE",
      },
    );
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));

    const badLimit = await exports.default.fetch(
      "https://agents.test/api/backoffice/activity?limit=abc&cf_session=tok",
    );
    expect(badLimit.status).toBe(200);
    const badLimitBody = await badLimit.json<{ items: Array<{ summary: string }> }>();
    expect(badLimitBody.items.some((a) => a.summary === "hardening")).toBe(true);

    const badWindow = await exports.default.fetch(
      "https://agents.test/api/backoffice/activity?since=abc&before=xyz&cf_session=tok",
    );
    expect(badWindow.status).toBe(200);
    const badWindowBody = await badWindow.json<{ items: Array<{ summary: string }> }>();
    expect(badWindowBody.items.some((a) => a.summary === "hardening")).toBe(true);
  });
});

describe("operator override decide", () => {
  it("returns 404 for an unknown action id", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(Response.json(meStaff)));
    const res = await exports.default.fetch(
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
    const res = await exports.default.fetch(
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
