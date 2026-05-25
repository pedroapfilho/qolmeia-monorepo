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

type TicketRow = {
  agent_instance_id: string;
  brief: string;
  company_id: string;
  id: string;
  result: string | null;
  status: string;
  workflow_id: string | null;
};

type AgentInstanceRow = { id: string; template_id: string | null };

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

const safeJson = (value: string | null): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const mapTicket = (row: TicketRow): Ticket => ({
  agentInstanceId: row.agent_instance_id,
  brief: row.brief,
  companyId: row.company_id,
  id: row.id,
  result: safeJson(row.result),
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

const loadAgentInstance = async (
  db: D1Database,
  id: string,
): Promise<{ id: string; templateId: string | null } | null> => {
  const row = await db
    .prepare("SELECT id, template_id FROM agent_instance WHERE id = ?")
    .bind(id)
    .first<AgentInstanceRow>();
  return row ? { id: row.id, templateId: row.template_id } : null;
};

const setTicketWorkflowId = async (
  db: D1Database,
  ticketId: string,
  workflowId: string,
): Promise<void> => {
  await db
    .prepare("UPDATE ticket SET workflow_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?")
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
  loadAgentInstance,
  loadTicket,
  markTicketDone,
  setTicketStatus,
  setTicketWorkflowId,
};
export type { Ticket, TicketStatus };
