import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  decideAction,
  getAction,
  listPendingActions,
  markExecuted,
  proposeAction,
} from "@/db/action";

const COMPANY_ID = "co_action_test";

beforeEach(async () => {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO company
       (id, name, slug, timezone, locale, status, brief, created_at, updated_at)
     VALUES (?, 'Action Test', 'action-test', 'America/Sao_Paulo', 'pt-BR', 'active', NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO agent_instance
       (id, company_id, role, template_id, template_version, display_name,
        model_override, status, created_at, updated_at)
     VALUES ('agent-action-test', ?, 'worker', 'tpl-designer', 1, 'd', NULL, 'active', 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ticket
       (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
        status, origin, workflow_id, result, created_at, updated_at)
     VALUES ('tkt-action-test', ?, 'agent-action-test', NULL, 't', 'b',
             'open', 'delegation', NULL, NULL, 0, 0)`,
  )
    .bind(COMPANY_ID)
    .run();
});

describe("proposeAction + getAction", () => {
  it("inserts a pending action; getAction round-trips it", async () => {
    const { id } = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { summary: "let's ship X" },
      ticketId: "tkt-action-test",
    });
    const action = await getAction(env.DB, id);
    expect(action).not.toBeNull();
    expect(action?.status).toBe("pending");
    expect(action?.policy).toBe("require-approval");
    const proposed = action?.proposed as { summary?: string } | undefined;
    expect(proposed?.summary).toBe("let's ship X");
  });
});

describe("decideAction", () => {
  it("transitions pending → approved and returns true", async () => {
    const { id } = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: {},
      ticketId: "tkt-action-test",
    });
    const ok = await decideAction(env.DB, {
      actionId: id,
      decidedByUserId: "user-1",
      decision: "approved",
    });
    expect(ok).toBe(true);
    const after = await getAction(env.DB, id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedByUserId).toBe("user-1");
  });

  it("is idempotent — a second decide returns false and leaves the row alone", async () => {
    const { id } = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: {},
      ticketId: "tkt-action-test",
    });
    await decideAction(env.DB, {
      actionId: id,
      decidedByUserId: "user-1",
      decision: "approved",
    });
    const second = await decideAction(env.DB, {
      actionId: id,
      decidedByUserId: "user-2",
      decision: "rejected",
    });
    expect(second).toBe(false);
    const after = await getAction(env.DB, id);
    expect(after?.status).toBe("approved");
    expect(after?.decidedByUserId).toBe("user-1");
  });
});

describe("markExecuted + listPendingActions", () => {
  it("markExecuted moves approved → executed; listPendingActions excludes it", async () => {
    const { id } = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: {},
      ticketId: "tkt-action-test",
    });
    await decideAction(env.DB, {
      actionId: id,
      decidedByUserId: "user-1",
      decision: "approved",
    });
    await markExecuted(env.DB, id);
    const after = await getAction(env.DB, id);
    expect(after?.status).toBe("executed");
    const pending = await listPendingActions(env.DB, { companyId: COMPANY_ID });
    expect(pending.find((a) => a.id === id)).toBeUndefined();
  });

  it("listPendingActions returns oldest-first within companyId", async () => {
    // Two DISTINCT tickets: proposeAction is now idempotent on (ticketId,
    // pending), so two proposes for the same ticket would collapse to one row.
    // One action per ticket keeps two pending rows to order.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ticket
         (id, company_id, agent_instance_id, parent_ticket_id, title, brief,
          status, origin, workflow_id, result, created_at, updated_at)
       VALUES ('tkt-action-test-2', ?, 'agent-action-test', NULL, 't2', 'b',
               'open', 'delegation', NULL, NULL, 0, 0)`,
    )
      .bind(COMPANY_ID)
      .run();
    const first = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { n: 1 },
      ticketId: "tkt-action-test",
    });
    // Force a clock gap so the second row is strictly newer.
    await new Promise<void>((r) => {
      setTimeout(r, 5);
    });
    const second = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { n: 2 },
      ticketId: "tkt-action-test-2",
    });
    const pending = await listPendingActions(env.DB, { companyId: COMPANY_ID });
    const indexFirst = pending.findIndex((a) => a.id === first.id);
    const indexSecond = pending.findIndex((a) => a.id === second.id);
    expect(indexFirst).toBeLessThan(indexSecond);
  });

  it("is idempotent on (ticketId, pending): double-propose returns the same id, one row", async () => {
    const first = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { attempt: 1 },
      ticketId: "tkt-action-test",
    });
    const second = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { attempt: 2 },
      ticketId: "tkt-action-test",
    });
    expect(second.id).toBe(first.id);
    const pending = await listPendingActions(env.DB, { companyId: COMPANY_ID });
    const forTicket = pending.filter((a) => a.ticketId === "tkt-action-test");
    expect(forTicket).toHaveLength(1);
    expect(forTicket[0]?.id).toBe(first.id);
  });

  it("allows a fresh propose once the prior action is no longer pending", async () => {
    const first = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { attempt: 1 },
      ticketId: "tkt-action-test",
    });
    await decideAction(env.DB, {
      actionId: first.id,
      decidedByUserId: "op-1",
      decision: "rejected",
    });
    // The prior action is decided (not pending), so a retry/new run may insert a
    // fresh pending row for the same ticket.
    const second = await proposeAction(env.DB, {
      actionType: "worker_deliverable",
      companyId: COMPANY_ID,
      policy: "require-approval",
      proposed: { attempt: 2 },
      ticketId: "tkt-action-test",
    });
    expect(second.id).not.toBe(first.id);
  });
});
