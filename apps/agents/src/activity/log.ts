import type { ActivityEntry } from "@repo/worker-api/contracts";

import type { ActivityEvent } from "#/activity/types";
import type { Database } from "#/db/client";

type LogActivityInput = ActivityEvent & {
  actorId?: string;
  companyId: string;
  summary: string;
};
const logActivity = async (db: Database, input: LogActivityInput): Promise<void> => {
  try {
    await db.activityLog.create({
      data: {
        actorId: input.actorId,
        companyId: input.companyId,
        id: crypto.randomUUID(),
        payload: input.payload,
        refId: input.refId,
        refType: input.refType,
        summary: input.summary,
        type: input.type,
      },
    });
  } catch (error) {
    // oxlint-disable-next-line no-console
    console.error("[activity] log write failed (best-effort, continuing)", {
      error,
      type: input.type,
    });
  }
};

const ACTIVITY_CATEGORIES = ["ACTION", "TICKET", "WORKER", "TEAM", "MEMBER"] as const;
type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
type ListActivityOptions = {
  before?: number;
  category?: ActivityCategory;
  companyId?: string;
  limit?: number;
  since?: number;
};

const listActivity = async (
  db: Database,
  options: ListActivityOptions = {},
): Promise<ReadonlyArray<ActivityEntry>> => {
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
    // SAFETY: logActivity is the only writer and accepts the ActivityEvent payload contract.
    // oxlint-disable-next-line no-unsafe-type-assertion
    payload: row.payload as Record<string, unknown> | null,
    refId: row.refId,
    refType: row.refType,
    summary: row.summary,
    type: row.type,
  }));
};

export { ACTIVITY_CATEGORIES, listActivity, logActivity };
export type { LogActivityInput };
