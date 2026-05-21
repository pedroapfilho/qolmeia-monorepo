import type { ActivityLog, PrismaClient } from "@repo/db";

type ActivityQueryPrisma = Pick<PrismaClient, "activityLog">;

type GetRecentActivityArgs = {
  limit?: number;
  orgId: string;
  prisma: ActivityQueryPrisma;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// Reads the most recent ActivityLog rows for an org, newest first. Used by
// tests today; the future web UI consumes the same shape so the contract is
// locked in early.
const getRecentActivity = (args: GetRecentActivityArgs): Promise<ReadonlyArray<ActivityLog>> => {
  const requested = args.limit ?? DEFAULT_LIMIT;
  // Clamp to MAX_LIMIT defensively — a UI bug shouldn't pull the whole table.
  const take = Math.max(1, Math.min(requested, MAX_LIMIT));
  return args.prisma.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    where: { orgId: args.orgId },
  });
};

export { getRecentActivity };
export type { ActivityQueryPrisma, GetRecentActivityArgs };
