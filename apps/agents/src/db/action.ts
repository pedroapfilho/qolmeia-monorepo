import type { Policy } from "@/db/policy";

// The `action` table is the spec's approval surface. Every gated thing a
// Worker wants to do is proposed here; the Workflow pauses until the row
// transitions out of `pending`. Backoffice (T7) reads via the same shape.

type ActionStatus =
  | "approved"
  | "changes_requested"
  | "executed"
  | "pending"
  | "rejected";

type DecisionOutcome = "approved" | "changes_requested" | "rejected";

type Action = {
  actionType: string;
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
};

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

const safeJson = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const mapAction = (row: ActionRow): Action => ({
  actionType: row.action_type,
  companyId: row.company_id,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  decidedByUserId: row.decided_by_user_id,
  feedback: row.feedback,
  id: row.id,
  policy: toPolicy(row.policy),
  proposed: safeJson(row.proposed),
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

const proposeAction = async (
  db: D1Database,
  input: ProposeActionInput,
): Promise<{ id: string }> => {
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
    .bind(
      input.decision,
      input.decidedByUserId,
      Date.now(),
      input.feedback ?? null,
      input.actionId,
    )
    .run();
  return (meta?.changes ?? 0) > 0;
};

const markExecuted = async (db: D1Database, actionId: string): Promise<void> => {
  await db
    .prepare("UPDATE action SET status = 'executed' WHERE id = ?")
    .bind(actionId)
    .run();
};

const getAction = async (db: D1Database, actionId: string): Promise<Action | null> => {
  const row = await db.prepare("SELECT * FROM action WHERE id = ?").bind(actionId).first<ActionRow>();
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
          "SELECT * FROM action WHERE status = 'pending' AND company_id = ? ORDER BY created_at ASC LIMIT ?",
        )
        .bind(options.companyId, limit)
    : db
        .prepare("SELECT * FROM action WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?")
        .bind(limit);
  const { results } = await cursor.all<ActionRow>();
  return results.map(mapAction);
};

export {
  decideAction,
  getAction,
  listPendingActions,
  markExecuted,
  proposeAction,
};
export type { Action, ActionStatus, DecideActionInput, DecisionOutcome, ProposeActionInput };
