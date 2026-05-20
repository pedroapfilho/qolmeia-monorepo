import { prisma } from "@repo/db";
import { type ConnectionOptions, Worker } from "bullmq";

import { QUEUE_NAME, type SerializedAgentJob } from "../agents/bullmq-dispatcher";
import type { AgentRunResult } from "../agents/dispatcher";
import { dispatcher as mainDispatcher } from "../agents/main-dispatcher";
import { runAgentInstance } from "../agents/runtime";
import { logger } from "../lib/logger";

const startAgentRunner = (connection: ConnectionOptions, concurrency: number): Worker => {
  const worker = new Worker<SerializedAgentJob, AgentRunResult>(
    QUEUE_NAME,
    async (job) => {
      logger.info(
        {
          agentInstanceId: job.data.agentInstance.id,
          jobId: job.id,
          orgId: job.data.agentInstance.orgId,
        },
        "agent-runner.job_received",
      );
      // Reconstruct AgentDispatchArgs: re-attach prisma + dispatcher.
      // The dispatcher reference allows delegation skills to enqueue
      // child jobs through the same queue.
      const result = await runAgentInstance({
        ...job.data,
        dispatcher: mainDispatcher,
        prisma,
      });
      logger.info(
        {
          agentInstanceId: job.data.agentInstance.id,
          generatedAssetIds: result.generatedAssetIds,
          jobId: job.id,
          orgId: job.data.agentInstance.orgId,
          tokensIn: result.usage.inputTokens,
          tokensOut: result.usage.outputTokens,
          toolCallSummary: result.toolCallSummary,
        },
        "agent-runner.job_completed",
      );
      return result;
    },
    { concurrency, connection },
  );

  worker.on("failed", (job, error) => {
    logger.error(
      { error, jobId: job?.id, orgId: job?.data.agentInstance.orgId },
      "agent-runner.job_failed",
    );
  });

  worker.on("error", (error) => {
    logger.error({ error }, "agent-runner.worker_error");
  });

  return worker;
};

export { startAgentRunner };
