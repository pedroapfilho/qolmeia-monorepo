import { prisma } from "@repo/db";
import type { Queue } from "bullmq";

import { env } from "../lib/env";
import { logger } from "../lib/logger";

import { createRoutineQueue } from "./queue";
import type { RoutineJobData } from "./queue";
import { reconcileRoutines } from "./reconcile";

// Lazy-built BullMQ queue used by the API process (NOT the worker) to
// reconcile routine schedulers after /ligar/desligar. The worker has its
// own queue+worker pair; this one only owns the JobScheduler state.
//
// We don't eagerly create it at import time because the unit-test
// environment never connects to Redis — building it lazily keeps tests
// that import the owner-commands module cheap.
let cachedQueue: Queue<RoutineJobData> | undefined;

const parseRedisUrl = (
  url: string,
): { host: string; password?: string; port: number; username?: string } => {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    password: parsed.password || undefined,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
  };
};

const getRoutineQueue = (): Queue<RoutineJobData> => {
  if (cachedQueue) {
    return cachedQueue;
  }
  const connection = parseRedisUrl(env.REDIS_URL);
  cachedQueue = createRoutineQueue(connection);
  return cachedQueue;
};

// Reconciles BullMQ JobSchedulers against the DB Routine rows. Called from
// owner-commands after enable/disable so the change takes effect immediately
// without waiting for the worker's next boot pass.
const triggerReconcile = async (): Promise<void> => {
  try {
    await reconcileRoutines({ prisma, queue: getRoutineQueue() });
  } catch (error) {
    logger.error({ error }, "routines.scheduler-control.reconcile_failed");
  }
};

export { getRoutineQueue, triggerReconcile };
