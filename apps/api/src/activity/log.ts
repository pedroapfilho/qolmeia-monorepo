import type { ActivityLogRefType, ActivityLogType, PrismaClient } from "@repo/db";

import { logger } from "../lib/logger";

// Single write-point for ActivityLog rows. Future versions will also fan out
// to a Streams bus / webhooks from here, so every call site touches this
// helper instead of the Prisma model directly.

type ActivityLogPrisma = Pick<PrismaClient, "activityLog">;

type LogActivityArgs = {
  // User id for human-initiated events. Today everything is system-initiated
  // (no human writes); reserved for the future multi-user model.
  actorId?: string | null;
  orgId: string;
  payload?: unknown;
  prisma: ActivityLogPrisma;
  refId?: string | null;
  refType: ActivityLogRefType;
  summary: string;
  type: ActivityLogType;
};

const logActivity = async (args: LogActivityArgs): Promise<void> => {
  try {
    await args.prisma.activityLog.create({
      data: {
        actorId: args.actorId ?? null,
        orgId: args.orgId,
        payload: (args.payload as object | undefined) ?? undefined,
        refId: args.refId ?? null,
        refType: args.refType,
        summary: args.summary,
        type: args.type,
      },
    });
  } catch (error) {
    // Activity logging is best-effort — it must NEVER break the inbound
    // pipeline or an agent run. The row is informational; structured Pino
    // logs remain the source-of-truth for ops.
    logger.error(
      { error, orgId: args.orgId, refType: args.refType, type: args.type },
      "activityLog.write.failed",
    );
  }
};

export { logActivity };
export type { ActivityLogPrisma, LogActivityArgs };
