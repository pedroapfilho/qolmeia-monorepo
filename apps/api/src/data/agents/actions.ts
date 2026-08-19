import type { Prisma } from "@repo/db";
import type { Action, DecisionOutcome } from "@repo/worker-api/contracts";
import type { ActivityInput, ActivityOptions } from "@repo/worker-api/internal";

import { jsonRecordSchema, nullableJsonRecord, type Database } from "./types";

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
  proposed: jsonRecordSchema.parse(row.proposed),
  status: row.status,
  ticketId: row.ticketId,
});

const proposeAction = async (
  db: Database,
  input: {
    actionType: string;
    companyId: string;
    policy: Action["policy"];
    proposed: Record<string, unknown>;
    ticketId: string;
  },
): Promise<{ id: string }> => {
  const existing = await db.action.findFirst({
    select: { id: true },
    where: { status: "pending", ticketId: input.ticketId },
  });
  if (existing) {
    return existing;
  }
  return db.action.create({
    data: {
      ...input,
      id: crypto.randomUUID(),
      proposed: jsonRecordSchema.parse(input.proposed),
      status: "pending",
    },
    select: { id: true },
  });
};

const decideAction = async (
  db: Database,
  input: {
    actionId: string;
    decidedByUserId: string;
    decision: DecisionOutcome;
    feedback?: string;
  },
): Promise<boolean> => {
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

const listPendingActions = async (
  db: Database,
  options: {
    companyId?: string;
    companyIds?: ReadonlyArray<string>;
    disciplines?: ReadonlyArray<string>;
    limit?: number;
  },
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
  options: { companyId?: string; limit?: number },
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

const logActivity = async (db: Database, input: ActivityInput): Promise<void> => {
  try {
    await db.activityLog.create({
      data: {
        actorId: input.actorId,
        companyId: input.companyId,
        id: crypto.randomUUID(),
        payload: input.payload === undefined ? undefined : jsonRecordSchema.parse(input.payload),
        refId: input.refId,
        refType: input.refType,
        summary: input.summary,
        type: input.type,
      },
    });
  } catch (error) {
    // oxlint-disable-next-line no-console -- Losing an audit entry must remain visible even though activity writes are best-effort.
    console.error("[activity] log write failed (best-effort, continuing)", {
      error,
      type: input.type,
    });
  }
};

const listActivity = async (db: Database, options: ActivityOptions) => {
  const rows = await db.activityLog.findMany({
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 100,
    where: {
      companyId: options.companyId,
      createdAt: {
        gte: options.since === undefined ? undefined : new Date(options.since),
        lt: options.before === undefined ? undefined : new Date(options.before),
      },
      type: options.category ? { startsWith: `${options.category}_` } : undefined,
    },
  });
  return rows.map((row) => ({
    actorId: row.actorId,
    companyId: row.companyId,
    companyName: row.company.name,
    createdAt: row.createdAt.getTime(),
    id: row.id,
    payload: nullableJsonRecord(row.payload),
    refId: row.refId,
    refType: row.refType,
    summary: row.summary,
    type: row.type,
  }));
};

export {
  decideAction,
  getAction,
  listActions,
  listActionsForTicket,
  listActivity,
  listPendingActions,
  logActivity,
  markExecuted,
  proposeAction,
};
