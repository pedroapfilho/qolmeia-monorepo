import { safeJson, toEnum } from "#/db/mappers";
import type { Policy } from "#/db/policy";

type ActionStatus = "approved" | "changes_requested" | "executed" | "pending" | "rejected";

type DecisionOutcome = "approved" | "changes_requested" | "rejected";

type AgentRole = "correspondent" | "planner" | "worker";

type ActionAgent = {
  name: string;
  role: AgentRole;
  workerKind: string | null;
};

type Action = {
  actionType: string;
  agent: ActionAgent;
  companyId: string;
  companyName: string;
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
  company_name: string;
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

const toAgentRole = toEnum<AgentRole>(["correspondent", "planner", "worker"], "worker");

const ACTION_WITH_AGENT_FROM = `FROM action
       JOIN ticket tk ON tk.id = action.ticket_id
       JOIN agent_instance ai ON ai.id = tk.agent_instance_id
       LEFT JOIN template tpl ON tpl.id = ai.template_id
       JOIN company co ON co.id = action.company_id`;
const ACTION_WITH_AGENT_COLS = `action.*, ai.display_name AS agent_name, ai.role AS agent_role, tpl.worker_kind AS worker_kind, co.name AS company_name`;

const toStatus = toEnum<ActionStatus>(
  ["approved", "changes_requested", "executed", "pending", "rejected"],
  "pending",
);

const toPolicy = toEnum<Policy>(
  ["auto-execute", "notify-only", "require-approval"],
  "require-approval",
);

const mapAction = (row: ActionRow): Action => ({
  actionType: row.action_type,
  agent: { name: row.agent_name, role: toAgentRole(row.agent_role), workerKind: row.worker_kind },
  companyId: row.company_id,
  companyName: row.company_name,
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

const listPendingActions = async (
  db: D1Database,
  options: {
    companyId?: string;
    companyIds?: ReadonlyArray<string>;
    disciplines?: ReadonlyArray<string>;
    limit?: number;
  } = {},
): Promise<ReadonlyArray<Action>> => {
  const limit = options.limit ?? 100;
  const clauses: Array<string> = ["action.status = 'pending'"];
  const params: Array<number | string> = [];
  if (options.companyId !== undefined && options.companyId !== "") {
    clauses.push("action.company_id = ?");
    params.push(options.companyId);
  } else if (options.companyIds && options.companyIds.length > 0) {
    clauses.push(`action.company_id IN (${options.companyIds.map(() => "?").join(", ")})`);
    params.push(...options.companyIds);
  }
  if (options.disciplines && options.disciplines.length > 0) {
    clauses.push(`tpl.worker_kind IN (${options.disciplines.map(() => "?").join(", ")})`);
    params.push(...options.disciplines);
  }
  params.push(limit);
  const { results } = await db
    .prepare(
      `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE ${clauses.join(" AND ")} ORDER BY action.created_at ASC LIMIT ?`,
    )
    .bind(...params)
    .all<ActionRow>();
  return results.map(mapAction);
};

const listActions = async (
  db: D1Database,
  options: { companyId?: string; limit?: number } = {},
): Promise<ReadonlyArray<Action>> => {
  const limit = Math.min(options.limit ?? 200, 500);
  const cursor =
    options.companyId !== undefined && options.companyId !== ""
      ? db
          .prepare(
            `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} WHERE action.company_id = ? ORDER BY action.created_at DESC LIMIT ?`,
          )
          .bind(options.companyId, limit)
      : db
          .prepare(
            `SELECT ${ACTION_WITH_AGENT_COLS} ${ACTION_WITH_AGENT_FROM} ORDER BY action.created_at DESC LIMIT ?`,
          )
          .bind(limit);
  const { results } = await cursor.all<ActionRow>();
  return results.map(mapAction);
};

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
