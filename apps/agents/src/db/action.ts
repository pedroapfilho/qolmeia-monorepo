import { safeJson } from "@/db/mappers";
import type { Policy } from "@/db/policy";

// The `action` table is the spec's approval surface. Every gated thing a
// Worker wants to do is proposed here; the Workflow pauses until the row
// transitions out of `pending`. Backoffice (T7) reads via the same shape.

type ActionStatus = "approved" | "changes_requested" | "executed" | "pending" | "rejected";

type DecisionOutcome = "approved" | "changes_requested" | "rejected";

type AgentRole = "correspondent" | "planner" | "worker";

// The agent that owns the action's ticket (action → ticket → agent_instance).
// Lets the operator views show the role-keyed avatar + agent name.
type ActionAgent = {
  name: string;
  role: AgentRole;
  workerKind: string | null;
};

type Action = {
  actionType: string;
  agent: ActionAgent;
  companyId: string;
  createdAt: number;
  decidedAt: number | null;
  decidedByUserId: string | null;
  feedback: string | null;
  id: string;
  policy: Policy;
  proposed: Record<string, unknown>;
  status: ActionStatus;
  ticketId: string;
};

type ActionRow = {
  action_type: string;
  agent_name: string;
  agent_role: string;
  company_id: string;
  created_at: number;
  decided_at: number | null;
  decided_by_user_id: string | null;
  feedback: string | null;
  id: string;
  policy: string;
  proposed: string;
  status: string;
  ticket_id: string;
  worker_kind: string | null;
};

const toAgentRole = (raw: string): AgentRole =>
  raw === "correspondent" || raw === "planner" || raw === "worker" ? raw : "worker";

// action.* + the owning agent, joined through the ticket. Qualify the shared
// column names (id/company_id/status/created_at) with `action.` in callers.
const ACTION_WITH_AGENT_FROM = `FROM action
       JOIN ticket tk ON tk.id = action.ticket_id
       JOIN agent_instance ai ON ai.id = tk.agent_instance_id
       LEFT JOIN template tpl ON tpl.id = ai.template_id`;
const ACTION_WITH_AGENT_COLS = `action.*, ai.display_name AS agent_name, ai.role AS agent_role, tpl.worker_kind AS worker_kind`;

const toStatus = (raw: string): ActionStatus => {
  const valid: ReadonlyArray<ActionStatus> = [
    "approved",
    "changes_requested",
    "executed",
    "pending",
    "rejected",
  ];
  return valid.find((s) => s === raw) ?? "pending";
};

const toPolicy = (raw: string): Policy => {
  const valid: ReadonlyArray<Policy> = ["auto-execute", "notify-only", "require-approval"];
  return valid.find((p) => p === raw) ?? "require-approval";
};

const mapAction = (row: ActionRow): Action => ({
  actionType: row.action_type,
  agent: { name: row.agent_name, role: toAgentRole(row.agent_role), workerKind: row.worker_kind },
  companyId: row.company_id,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  decidedByUserId: row.decided_by_user_id,
  feedback: row.feedback,
  id: row.id,
  policy: toPolicy(row.policy),
  proposed: safeJson<Record<string, unknown>>(row.proposed, {}),
  status: toStatus(row.status),
  ticketId: row.ticket_id,
});

type ProposeActionInput = {
  actionType: string;
  companyId: string;
  policy: Policy;
  proposed: Record<string, unknown>;
  ticketId: string;
};

// Idempotent on (ticketId, status='pending'): if a pending action already
// exists for the ticket, return its id instead of inserting a second row.
// Cloudflare Workflows retry a `step.do` block on failure and may re-run a step
// whose body partially executed — so if a write *after* this INSERT throws, the
// step retries and calls propose again. Without this guard that minted a fresh
// UUID and inserted a duplicate pending approval (the first one's `waitForEvent`
// would then never resume). A single ticket's workflow is the only writer of its
// pending action, so a look-before-insert has no cross-writer race within the DO.
const proposeAction = async (
  db: D1Database,
  input: ProposeActionInput,
): Promise<{ id: string }> => {
  const existing = await db
    .prepare("SELECT id FROM action WHERE ticket_id = ? AND status = 'pending' LIMIT 1")
    .bind(input.ticketId)
    .first<{ id: string }>();
  if (existing) {
    return { id: existing.id };
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO action
         (id, ticket_id, company_id, action_type, policy, proposed, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      id,
      input.ticketId,
      input.companyId,
      input.actionType,
      input.policy,
      JSON.stringify(input.proposed),
      now,
    )
    .run();
  return { id };
};

type DecideActionInput = {
  actionId: string;
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

// Idempotent on (id, status='pending') — a second decision call against a
// non-pending action is a no-op rather than an error. Returns whether the
// row actually transitioned.
const decideAction = async (db: D1Database, input: DecideActionInput): Promise<boolean> => {
  const { meta } = await db
    .prepare(
      `UPDATE action
         SET status = ?, decided_by_user_id = ?, decided_at = ?, feedback = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .bind(input.decision, input.decidedByUserId, Date.now(), input.feedback ?? null, input.actionId)
    .run();
  return (meta?.changes ?? 0) > 0;
};

const markExecuted = async (db: D1Database, actionId: string): Promise<void> => {
  await db.prepare("UPDATE action SET status = 'executed' WHERE id = ?").bind(actionId).run();
};

const getAction = async (db: D1Database, actionId: string): Promise<Action | null> => {
  const row = await db
    .prepare(`SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.id = ?`)
    .bind(actionId)
    .first<ActionRow>();
  return row ? mapAction(row) : null;
};

// Pending actions oldest-first — the stale-backlog view.
const listPendingActions = async (
  db: D1Database,
  options: { companyId?: string; limit?: number } = {},
): Promise<ReadonlyArray<Action>> => {
  const limit = options.limit ?? 100;
  const cursor = options.companyId
    ? db
        .prepare(
          `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.status = 'pending' AND action.company_id = ? ORDER BY action.created_at ASC LIMIT ?`,
        )
        .bind(options.companyId, limit)
    : db
        .prepare(
          `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.status = 'pending' ORDER BY action.created_at ASC LIMIT ?`,
        )
        .bind(limit);
  const { results } = await cursor.all<ActionRow>();
  return results.map(mapAction);
};

// Any-status list, newest-first. The "no query filter" branch of the
// backoffice /actions endpoint.
const listActions = async (
  db: D1Database,
  options: { companyId: string; limit?: number },
): Promise<ReadonlyArray<Action>> => {
  const limit = Math.min(options.limit ?? 200, 500);
  const { results } = await db
    .prepare(
      `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.company_id = ? ORDER BY action.created_at DESC LIMIT ?`,
    )
    .bind(options.companyId, limit)
    .all<ActionRow>();
  return results.map(mapAction);
};

// All actions tied to a ticket, oldest-first — the ticket-detail drill-down.
const listActionsForTicket = async (
  db: D1Database,
  ticketId: string,
): Promise<ReadonlyArray<Action>> => {
  const { results } = await db
    .prepare(
      `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.ticket_id = ? ORDER BY action.created_at ASC`,
    )
    .bind(ticketId)
    .all<ActionRow>();
  return results.map(mapAction);
};

export {
  decideAction,
  getAction,
  listActions,
  listActionsForTicket,
  listPendingActions,
  markExecuted,
  proposeAction,
};
export type {
  Action,
  ActionAgent,
  ActionStatus,
  DecideActionInput,
  DecisionOutcome,
  ProposeActionInput,
};
