import type { Prisma } from "@repo/db/worker";
import type {
  InstanceWithTemplate,
  Ticket,
  TicketListRow,
  TicketStatus,
} from "@repo/worker-api/contracts";

import { logActivity, type LogActivityInput } from "#/activity/log";
import type { Database } from "#/db/client";
import { getTemplate } from "#/db/template";
import { toRecord } from "#/lib/records";
import { emitTeamEvent } from "#/team/events";

const mapTicket = (row: {
  agentInstanceId: string;
  brief: string;
  companyId: string;
  id: string;
  result: Prisma.JsonValue;
  status: TicketStatus;
  workflowId: string | null;
}): Ticket => ({
  agentInstanceId: row.agentInstanceId,
  brief: row.brief,
  companyId: row.companyId,
  id: row.id,
  result: row.result === null ? null : toRecord(row.result),
  status: row.status,
  workflowId: row.workflowId,
});

const loadTicket = async (db: Database, id: string): Promise<Ticket | null> => {
  const row = await db.ticket.findUnique({ where: { id } });
  return row ? mapTicket(row) : null;
};

const listTickets = async (
  db: Database,
  options: { companyId?: string; limit?: number; status?: TicketStatus } = {},
): Promise<ReadonlyArray<TicketListRow>> => {
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
  result: Prisma.InputJsonObject,
): Promise<void> => {
  await db.ticket.update({
    data: { result, status: "done" },
    where: { id: ticketId },
  });
};

type TicketTransition = {
  activity: LogActivityInput;
  ticketId: string;
} & (
  | { result: Prisma.InputJsonObject; status: "done" }
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
  setTicketWorkflowId,
  transitionTicket,
};
export type { InstanceWithTemplate } from "@repo/worker-api/contracts";
