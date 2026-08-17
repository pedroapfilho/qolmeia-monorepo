import type { Prisma } from "@repo/db/worker";
import type { Action, DecisionOutcome } from "@repo/worker-api/contracts";

import type { Database } from "#/db/client";
import type { Policy } from "#/db/policy";

const actionInclude = {
  company: { select: { name: true } },
  ticket: {
    select: {
      agentInstance: {
        select: {
          displayName: true,
          role: true,
          template: { select: { workerKind: true } },
        },
      },
    },
  },
} as const satisfies Prisma.ActionInclude;

type ActionRecord = Prisma.ActionGetPayload<{ include: typeof actionInclude }>;

const mapAction = (row: ActionRecord): Action => ({
  actionType: row.actionType,
  agent: {
    name: row.ticket.agentInstance.displayName,
    role: row.ticket.agentInstance.role,
    workerKind: row.ticket.agentInstance.template?.workerKind ?? null,
  },
  companyId: row.companyId,
  companyName: row.company.name,
  createdAt: row.createdAt.getTime(),
  decidedAt: row.decidedAt?.getTime() ?? null,
  decidedByUserId: row.decidedByUserId,
  feedback: row.feedback,
  id: row.id,
  policy: row.policy,
  // oxlint-disable-next-line no-unsafe-type-assertion -- proposed is a JSON column written by proposeAction in this module
  proposed: row.proposed as Record<string, unknown>,
  status: row.status,
  ticketId: row.ticketId,
});

type ProposeActionInput = {
  actionType: string;
  companyId: string;
  policy: Policy;
  proposed: Record<string, unknown>;
  ticketId: string;
};

const proposeAction = async (db: Database, input: ProposeActionInput): Promise<{ id: string }> => {
  const existing = await db.action.findFirst({
    select: { id: true },
    where: { status: "pending", ticketId: input.ticketId },
  });
  if (existing) {
    return existing;
  }
  return db.action.create({
    data: {
      actionType: input.actionType,
      companyId: input.companyId,
      id: crypto.randomUUID(),
      policy: input.policy,
      // oxlint-disable-next-line no-unsafe-type-assertion -- callers pass JSON-serializable proposals; Prisma's write type is narrower than Record<string, unknown>
      proposed: input.proposed as Prisma.InputJsonValue,
      status: "pending",
      ticketId: input.ticketId,
    },
    select: { id: true },
  });
};

type DecideActionInput = {
  actionId: string;
  decidedByUserId: string;
  decision: DecisionOutcome;
  feedback?: string;
};

const decideAction = async (db: Database, input: DecideActionInput): Promise<boolean> => {
  const result = await db.action.updateMany({
    data: {
      decidedAt: new Date(),
      decidedByUserId: input.decidedByUserId,
      feedback: input.feedback ?? null,
      status: input.decision,
    },
    where: { id: input.actionId, status: "pending" },
  });
  return result.count > 0;
};

const markExecuted = async (db: Database, actionId: string): Promise<void> => {
  await db.action.updateMany({ data: { status: "executed" }, where: { id: actionId } });
};

const getAction = async (db: Database, actionId: string): Promise<Action | null> => {
  const row = await db.action.findUnique({ include: actionInclude, where: { id: actionId } });
  return row ? mapAction(row) : null;
};

type PendingOptions = {
  companyId?: string;
  companyIds?: ReadonlyArray<string>;
  disciplines?: ReadonlyArray<string>;
  limit?: number;
};

const listPendingActions = async (
  db: Database,
  options: PendingOptions = {},
): Promise<ReadonlyArray<Action>> => {
  let companyId: string | { in: Array<string> } | undefined;
  if (options.companyId !== undefined && options.companyId !== "") {
    companyId = options.companyId;
  } else if (options.companyIds !== undefined && options.companyIds.length > 0) {
    companyId = { in: [...options.companyIds] };
  }
  const rows = await db.action.findMany({
    include: actionInclude,
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 100,
    where: {
      companyId,
      status: "pending",
      ticket:
        options.disciplines !== undefined && options.disciplines.length > 0
          ? { agentInstance: { template: { workerKind: { in: [...options.disciplines] } } } }
          : undefined,
    },
  });
  return rows.map(mapAction);
};

const listActions = async (
  db: Database,
  options: { companyId?: string; limit?: number } = {},
): Promise<ReadonlyArray<Action>> => {
  const rows = await db.action.findMany({
    include: actionInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 200, 500),
    where: { companyId: options.companyId },
  });
  return rows.map(mapAction);
};

const listActionsForTicket = async (
  db: Database,
  ticketId: string,
): Promise<ReadonlyArray<Action>> => {
  const rows = await db.action.findMany({
    include: actionInclude,
    orderBy: { createdAt: "asc" },
    where: { ticketId },
  });
  return rows.map(mapAction);
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
export type { DecideActionInput, ProposeActionInput };
