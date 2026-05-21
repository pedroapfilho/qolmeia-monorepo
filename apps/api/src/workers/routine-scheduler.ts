import { prisma } from "@repo/db";
import { type ConnectionOptions, Worker } from "bullmq";

import { dispatcher as mainDispatcher } from "../agents/main-dispatcher";
import { logger } from "../lib/logger";
import { executeRoutine } from "../routines/executor";
import { createRoutineQueue } from "../routines/queue";
import { reconcileRoutines } from "../routines/reconcile";
import type { RoutineJobData } from "../routines/queue";

// Boots the routine scheduler: creates the queue (so BullMQ keeps its
// JobScheduler state in Redis) and starts a Worker that runs each routine
// fire by name + routineId. The queue is returned so callers can pass it to
// reconcileRoutines whenever a routine row changes.
const startRoutineScheduler = (
  connection: ConnectionOptions,
  concurrency: number,
): {
  close: () => Promise<void>;
  reconcile: () => Promise<void>;
} => {
  const queue = createRoutineQueue(connection);

  const worker = new Worker<RoutineJobData>(
    queue.name,
    async (job) => {
      const routineId = job.data.routineId;
      logger.info({ jobId: job.id, routineId }, "routine-scheduler.job_received");
      const outcome = await executeRoutine({
        dispatcher: mainDispatcher,
        prisma,
        routineId,
      });
      logger.info(
        { agentRunId: outcome.agentRunId, jobId: job.id, routineId, status: outcome.status },
        "routine-scheduler.job_completed",
      );
    },
    { concurrency, connection },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { error, jobId: job?.id, routineId: job?.data.routineId },
      "routine-scheduler.job_failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ error }, "routine-scheduler.worker_error");
  });

  // Initial reconcile so a worker that boots into a fresh Redis instance
  // (or after a deployment that changed schedules) immediately catches up.
  const reconcile = async (): Promise<void> => {
    try {
      await reconcileRoutines({ prisma, queue });
    } catch (error) {
      logger.error({ error }, "routine-scheduler.reconcile.failed");
    }
  };
  void reconcile();

  return {
    close: async () => {
      await worker.close();
      await queue.close();
    },
    reconcile,
  };
};

export { startRoutineScheduler };
