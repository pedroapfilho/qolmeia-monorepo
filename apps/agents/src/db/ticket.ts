import { safeJson } from "@/db/mappers";

// Ticket DB helpers. Both the Worker DO (handing off) and the WorkerJob
// Workflow (running the work) need to load + mutate tickets — pulling these
// out of worker.ts shares them without a circular import.

type TicketStatus =
  | "awaiting_approval"
  | "blocked"
  | "cancelled"
  | "done"
  | "in_progress"
  | "open"
  | "rejected";

type Ticket = {
  agentInstanceId: string;
  brief: string;
  companyId: string;
  id: string;
  result: Record<string, unknown> | null;
  status: TicketStatus;
  workflowId: string | null;
};

// Extra fields surfaced by the list endpoint (title / origin / timestamps)
// that the loadTicket-by-id path doesn't read. Kept as a superset of Ticket
// so the list and detail responses share the typed mapper.
type TicketListItem = Ticket & {
  companyName: string;
  createdAt: number;
  origin: string;
  title: string;
  updatedAt: number;
};

type TicketRow = {
  agent_instance_id: string;
  brief: string;
  company_id: string;
  id: string;
  result: string | null;
  status: string;
  workflow_id: string | null;
};

type TicketListRow = TicketRow & {
  company_name: string;
  created_at: number;
  origin: string;
  title: string;
  updated_at: number;
};

type AgentInstanceRow = {
  id: string;
  prompt_override: string | null;
  template_id: string | null;
};

const toStatus = (raw: string): TicketStatus => {
  const valid: ReadonlyArray<TicketStatus> = [
    "awaiting_approval",
    "blocked",
    "cancelled",
    "done",
    "in_progress",
    "open",
    "rejected",
  ];
  return valid.find((s) => s === raw) ?? "open";
};

const mapTicket = (row: TicketRow): Ticket => ({
  agentInstanceId: row.agent_instance_id,
  brief: row.brief,
  companyId: row.company_id,
  id: row.id,
  result: safeJson<Record<string, unknown> | null>(row.result, null),
  status: toStatus(row.status),
  workflowId: row.workflow_id,
});

const loadTicket = async (db: D1Database, id: string): Promise<Ticket | null> => {
  const row = await db
    .prepare(
      "SELECT id, company_id, agent_instance_id, brief, status, workflow_id, result FROM ticket WHERE id = ?",
    )
    .bind(id)
    .first<TicketRow>();
  return row ? mapTicket(row) : null;
};

const mapTicketListItem = (row: TicketListRow): TicketListItem => ({
  ...mapTicket(row),
  companyName: row.company_name,
  createdAt: row.created_at,
  origin: row.origin,
  title: row.title,
  updatedAt: row.updated_at,
});

type ListTicketsOptions = {
  companyId?: string;
  limit?: number;
  status?: string;
};

// Operator-facing ticket list. Returns the typed shape (camelCase) — the
// raw snake_case columns are mapped at the DB boundary so the backoffice
// only ever deals with one casing convention. Cross-tenant by default (the
// queue spans every company); companyId narrows to one. The company JOIN
// carries the name so a cross-tenant list can label each row.
const listTickets = async (
  db: D1Database,
  options: ListTicketsOptions = {},
): Promise<ReadonlyArray<TicketListItem>> => {
  const limit = Math.min(options.limit ?? 50, 200);
  const clauses: Array<string> = [];
  const params: Array<number | string> = [];
  if (options.companyId) {
    clauses.push("t.company_id = ?");
    params.push(options.companyId);
  }
  if (options.status) {
    clauses.push("t.status = ?");
    params.push(options.status);
  }
  params.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const { results } = await db
    .prepare(
      `SELECT t.id, t.company_id, t.agent_instance_id, t.title, t.brief, t.status,
              t.origin, t.workflow_id, t.result, t.created_at, t.updated_at,
              co.name AS company_name
         FROM ticket t
         JOIN company co ON co.id = t.company_id
         ${where} ORDER BY t.created_at DESC LIMIT ?`,
    )
    .bind(...params)
    .all<TicketListRow>();
  return results.map(mapTicketListItem);
};

const loadAgentInstance = async (
  db: D1Database,
  id: string,
): Promise<{ id: string; promptOverride: string | null; templateId: string | null } | null> => {
  const row = await db
    .prepare("SELECT id, template_id, prompt_override FROM agent_instance WHERE id = ?")
    .bind(id)
    .first<AgentInstanceRow>();
  return row
    ? {
        id: row.id,
        promptOverride: row.prompt_override,
        templateId: row.template_id,
      }
    : null;
};

const setTicketWorkflowId = async (
  db: D1Database,
  ticketId: string,
  workflowId: string,
): Promise<void> => {
  await db
    .prepare(
      "UPDATE ticket SET workflow_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?",
    )
    .bind(workflowId, Date.now(), ticketId)
    .run();
};

const setTicketStatus = async (
  db: D1Database,
  ticketId: string,
  status: TicketStatus,
): Promise<void> => {
  await db
    .prepare("UPDATE ticket SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), ticketId)
    .run();
};

const markTicketDone = async (
  db: D1Database,
  ticketId: string,
  result: Record<string, unknown>,
): Promise<void> => {
  await db
    .prepare("UPDATE ticket SET status = 'done', result = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(result), Date.now(), ticketId)
    .run();
};

export {
  listTickets,
  loadAgentInstance,
  loadTicket,
  markTicketDone,
  setTicketStatus,
  setTicketWorkflowId,
};
export type { Ticket, TicketListItem, TicketStatus };
