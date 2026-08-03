import type { Prisma } from "@repo/db/worker";

import { logActivity, type LogActivityInput } from "#/activity/log";
import type { Database } from "#/db/client";
import { toEnum } from "#/db/mappers";
import { getTemplate, type Template } from "#/db/template";
import { emitTeamEvent } from "#/team/events";

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
  // oxlint-disable-next-line no-unsafe-type-assertion -- result is a JSON column written by markTicketDone in this module
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

type InstanceWithTemplate = {
  agentInstance: { id: string; promptOverride: string | null; templateId: string };
  template: Template;
};

const loadInstanceWithTemplate = async (
  db: Database,
  agentInstanceId: string,
): Promise<InstanceWithTemplate> => {
  const agentInstance = await loadAgentInstance(db, agentInstanceId);
  const templateId = agentInstance?.templateId;
  if (!agentInstance || templateId === null || templateId === undefined || templateId === "") {
    throw new Error(`agent_instance ${agentInstanceId} is not linked to a template`);
  }
  const template = await getTemplate(db, templateId);
  if (!template) {
    throw new Error(`template ${templateId} not found`);
  }
  return { agentInstance: { ...agentInstance, templateId }, template };
};

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
    // oxlint-disable-next-line no-unsafe-type-assertion -- callers pass JSON-serializable skill output; Prisma's write type is narrower than Record<string, unknown>
    data: { result: result as Prisma.InputJsonValue, status: "done" },
    where: { id: ticketId },
  });
};

type TicketTransition = {
  activity: LogActivityInput;
  ticketId: string;
} & (
  | { result: Record<string, unknown>; status: "done" }
  | { status: Exclude<TicketStatus, "done"> }
);

const transitionTicket = async (env: Env, db: Database, input: TicketTransition): Promise<void> => {
  await Promise.all([
    input.status === "done"
      ? markTicketDone(db, input.ticketId, input.result)
      : setTicketStatus(db, input.ticketId, input.status),
    emitTeamEvent(env, {
      companyId: input.activity.companyId,
      reason: "ticket_changed",
      type: "team:status",
    }),
    logActivity(db, input.activity),
  ]);
};

export {
  listTickets,
  loadAgentInstance,
  loadInstanceWithTemplate,
  loadTicket,
  markTicketDone,
  setTicketStatus,
  setTicketWorkflowId,
  transitionTicket,
};
export type { InstanceWithTemplate, Ticket, TicketListItem, TicketStatus };
