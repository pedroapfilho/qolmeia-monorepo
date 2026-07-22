import type { Prisma } from "@repo/db/worker";

import type { Database } from "#/db/client";
import { toEnum } from "#/db/mappers";

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
type TicketListItem = Ticket & {
  companyName: string;
  createdAt: number;
  origin: string;
  title: string;
  updatedAt: number;
};

const toStatus = toEnum<TicketStatus>(
  ["awaiting_approval", "blocked", "cancelled", "done", "in_progress", "open", "rejected"],
  "open",
);
const mapTicket = (row: {
  agentInstanceId: string;
  brief: string;
  companyId: string;
  id: string;
  result: unknown;
  status: string;
  workflowId: string | null;
}): Ticket => ({
  agentInstanceId: row.agentInstanceId,
  brief: row.brief,
  companyId: row.companyId,
  id: row.id,
  result: row.result as Record<string, unknown> | null,
  status: toStatus(row.status),
  workflowId: row.workflowId,
});

const loadTicket = async (db: Database, id: string): Promise<Ticket | null> => {
  const row = await db.ticket.findUnique({ where: { id } });
  return row ? mapTicket(row) : null;
};

const listTickets = async (
  db: Database,
  options: { companyId?: string; limit?: number; status?: string } = {},
): Promise<ReadonlyArray<TicketListItem>> => {
  const rows = await db.ticket.findMany({
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
    where: { companyId: options.companyId, status: options.status },
  });
  return rows.map((row) =>
    Object.assign(mapTicket(row), {
      companyName: row.company.name,
      createdAt: row.createdAt.getTime(),
      origin: row.origin,
      title: row.title,
      updatedAt: row.updatedAt.getTime(),
    }),
  );
};

const loadAgentInstance = (
  db: Database,
  id: string,
): Promise<{ id: string; promptOverride: string | null; templateId: string | null } | null> =>
  db.agentInstance.findUnique({
    select: { id: true, promptOverride: true, templateId: true },
    where: { id },
  });

const setTicketWorkflowId = async (
  db: Database,
  ticketId: string,
  workflowId: string,
): Promise<void> => {
  await db.ticket.update({ data: { status: "in_progress", workflowId }, where: { id: ticketId } });
};
const setTicketStatus = async (
  db: Database,
  ticketId: string,
  status: TicketStatus,
): Promise<void> => {
  await db.ticket.update({ data: { status }, where: { id: ticketId } });
};
const markTicketDone = async (
  db: Database,
  ticketId: string,
  result: Record<string, unknown>,
): Promise<void> => {
  await db.ticket.update({
    data: { result: result as Prisma.InputJsonValue, status: "done" },
    where: { id: ticketId },
  });
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
