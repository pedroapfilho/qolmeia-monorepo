import type {
  InstanceWithTemplate,
  Ticket,
  TicketListRow,
  TicketStatus,
} from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";

const loadTicket = (db: Database, ticketId: string): Promise<Ticket | null> =>
  db("tickets.load", { ticketId });

const listTickets = (
  db: Database,
  options: { companyId?: string; limit?: number; status?: TicketStatus } = {},
): Promise<ReadonlyArray<TicketListRow>> => db("tickets.list", options);

const loadAgentInstance = (
  db: Database,
  agentInstanceId: string,
): Promise<{ id: string; promptOverride: string | null; templateId: string | null } | null> =>
  db("tickets.loadInstance", { agentInstanceId });

const loadInstanceWithTemplate = (
  db: Database,
  agentInstanceId: string,
): Promise<InstanceWithTemplate> => db("tickets.loadInstanceWithTemplate", { agentInstanceId });

const setTicketWorkflowId = async (
  db: Database,
  ticketId: string,
  workflowId: string,
): Promise<void> => {
  await db("tickets.setWorkflow", { ticketId, workflowId });
};

export {
  listTickets,
  loadAgentInstance,
  loadInstanceWithTemplate,
  loadTicket,
  setTicketWorkflowId,
};
export type { InstanceWithTemplate } from "@repo/worker-api/contracts";
