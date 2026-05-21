import type { PrismaClient } from "@repo/db";
import type { Queue } from "bullmq";

import { logger } from "../lib/logger";

// Stable BullMQ JobScheduler id derived from the DB Routine id. Used both
// when upserting (creating/updating the scheduler) and removing.
const schedulerIdFor = (routineId: string): string => `routine:${routineId}`;

// Minimal projection of a Routine the reconciler needs. Keeps the helper
// usable from tests that mock prisma narrowly.
type RoutineProjection = {
  enabled: boolean;
  id: string;
  schedule: string;
  timezone: string;
};

type ReconcilePrisma = Pick<PrismaClient, "routine">;

type ReconcileSummary = {
  added: number;
  removed: number;
  updated: number;
};

// Drives BullMQ's repeatable-job state machine toward the DB. The DB Routine
// rows are the source of truth: every enabled row should have a matching
// JobScheduler, every disabled row should NOT, and any drift in
// schedule/timezone reschedules the existing one.
//
// Note: BullMQ v5's `upsertJobScheduler` is idempotent — re-calling with the
// same `(id, schedule, tz)` is a no-op for next-fire computation. We still
// gate on a diff so reconcile passes are cheap when nothing changed.
const reconcileRoutines = async ({
  prisma,
  queue,
}: {
  prisma: ReconcilePrisma;
  queue: Pick<Queue, "getJobSchedulers" | "removeJobScheduler" | "upsertJobScheduler">;
}): Promise<ReconcileSummary> => {
  const rows: ReadonlyArray<RoutineProjection> = await prisma.routine.findMany({
    select: { enabled: true, id: true, schedule: true, timezone: true },
  });
  const desired = new Map<string, RoutineProjection>();
  for (const r of rows) {
    if (r.enabled) {
      desired.set(schedulerIdFor(r.id), r);
    }
  }

  const existingSchedulers = await queue.getJobSchedulers();
  // Track only schedulers we own (routine:*). Leave foreign ones alone in
  // case other features ever share this queue.
  const existingOwned = existingSchedulers.filter(
    (s) => typeof s.key === "string" && s.key.startsWith("routine:"),
  );

  let added = 0;
  let removed = 0;
  let updated = 0;

  // 1. Remove schedulers whose Routine row is disabled or deleted.
  await Promise.allSettled(
    existingOwned.map(async (scheduler) => {
      if (!desired.has(scheduler.key)) {
        await queue.removeJobScheduler(scheduler.key);
        removed += 1;
      }
    }),
  );

  // 2. Upsert schedulers for every enabled row. Reschedule when pattern/tz
  // drifted from the existing scheduler.
  const existingByKey = new Map(existingOwned.map((s) => [s.key, s]));
  await Promise.allSettled(
    [...desired.entries()].map(async ([key, routine]) => {
      const existing = existingByKey.get(key);
      const drift =
        existing === undefined ||
        existing.pattern !== routine.schedule ||
        (existing.tz ?? undefined) !== routine.timezone;
      if (!drift) {
        return;
      }
      await queue.upsertJobScheduler(
        key,
        { pattern: routine.schedule, tz: routine.timezone },
        { data: { routineId: routine.id }, name: "routine-run" },
      );
      if (existing === undefined) {
        added += 1;
      } else {
        updated += 1;
      }
    }),
  );

  logger.info({ added, removed, updated }, "routines.reconciled");
  return { added, removed, updated };
};

export { reconcileRoutines, schedulerIdFor };
export type { ReconcilePrisma, ReconcileSummary, RoutineProjection };
