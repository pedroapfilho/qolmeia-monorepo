import type { Prisma } from "@repo/db";
import type {
  InstanceWithTemplate,
  Ticket,
  TicketListRow,
  TicketStatus,
} from "@repo/worker-api/contracts";
import type { TicketTransitionInput } from "@repo/worker-api/internal";

import { logActivity } from "./actions";
import { getTemplate } from "./templates";
import { jsonRecordSchema, nullableJsonRecord, type Database } from "./types";

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
  result: nullableJsonRecord(row.result),
  status: row.status,
  workflowId: row.workflowId,
});

const loadTicket = async (db: Database, id: string): Promise<Ticket | null> => {
  const row = await db.ticket.findUnique({ where: { id } });
  return row ? mapTicket(row) : null;
};

const listTickets = async (
  db: Database,
  options: { companyId?: string; limit?: number; status?: TicketStatus },
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

const transitionTicketRecord = async (
  db: Database,
  input: TicketTransitionInput,
): Promise<void> => {
  const result = input.result === undefined ? undefined : jsonRecordSchema.parse(input.result);
  await db.ticket.update({
    data: input.status === "done" ? { result, status: "done" } : { status: input.status },
    where: { id: input.ticketId },
  });
  await logActivity(db, input.activity);
};

const transitionTicket = async (db: Database, input: TicketTransitionInput): Promise<void> => {
  await db.$transaction((tx) => transitionTicketRecord(tx, input));
};

const createDelegatedTicket = async (
  db: Database,
  input: {
    agentInstanceId: string;
    brief: string;
    companyId: string;
    ticketId: string;
    workerKind: string;
  },
): Promise<void> => {
  await db.ticket.create({
    data: {
      agentInstanceId: input.agentInstanceId,
      brief: input.brief,
      companyId: input.companyId,
      id: input.ticketId,
      origin: "delegation",
      title: `${input.workerKind}: ${input.brief.slice(0, 80)}`,
    },
  });
};

const listWorkerCandidates = async (db: Database, companyId: string, workerKind: string) => {
  const rows = await db.agentInstance.findMany({
    include: {
      _count: {
        select: {
          tickets: { where: { status: { in: ["in_progress", "awaiting_approval"] } } },
        },
      },
    },
    where: {
      companyId,
      role: "worker",
      status: "active",
      template: { status: "active", workerKind },
    },
  });
  return rows.map((row) => {
    // oxlint-disable-next-line no-underscore-dangle -- Prisma exposes relation counts through its generated _count field.
    return { busyCount: row._count.tickets, id: row.id };
  });
};

export {
  createDelegatedTicket,
  listTickets,
  listWorkerCandidates,
  loadAgentInstance,
  loadInstanceWithTemplate,
  loadTicket,
  setTicketWorkflowId,
  transitionTicket,
  transitionTicketRecord,
};
