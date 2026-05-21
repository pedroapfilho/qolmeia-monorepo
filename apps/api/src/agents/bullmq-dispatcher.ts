import type { AgentInstance, SenderRole } from "@repo/db";
import { type JobsOptions, Queue, QueueEvents } from "bullmq";

import { env } from "../lib/env";
import { logger } from "../lib/logger";

import { buildCoalesceKey } from "./dispatcher";
import type {
  AgentDispatchArgs,
  AgentDispatcher,
  AgentRunResult,
  DispatchOrigin,
} from "./dispatcher";

// The serializable subset of AgentDispatchArgs that we put on the queue.
// `prisma` and `dispatcher` are reconstructed by the worker from the
// module-level singletons; they cannot cross the queue boundary.
type SerializedAgentJob = {
  agentInstance: AgentInstance;
  existingAssets: AgentDispatchArgs["existingAssets"];
  input: {
    audioBytes?: Uint8Array;
    audioMime?: string;
    imageBytes: ReadonlyArray<{ assetId: string; bytes: Uint8Array; mimeType: string }>;
    text?: string;
  };
  newAssets: AgentDispatchArgs["newAssets"];
  oversizeCount: number;
  runId: string;
  senderRole: SenderRole | null;
  systemPrompt: string;
};

const QUEUE_NAME = "qolmeia-agent-run";

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

const createBullMQDispatcher = (): {
  close: () => Promise<void>;
  dispatcher: AgentDispatcher;
  queue: Queue<SerializedAgentJob, AgentRunResult>;
} => {
  const connection = parseRedisUrl(env.REDIS_URL);
  const queue = new Queue<SerializedAgentJob, AgentRunResult>(QUEUE_NAME, { connection });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

  const dispatcher: AgentDispatcher = {
    enqueueAndAwait: async (args) => {
      // Strip non-serializable fields (prisma, dispatcher) before enqueue.
      const payload: SerializedAgentJob = {
        agentInstance: args.agentInstance,
        existingAssets: args.existingAssets,
        input: args.input,
        newAssets: args.newAssets,
        oversizeCount: args.oversizeCount,
        runId: args.runId,
        senderRole: args.senderRole,
        systemPrompt: args.systemPrompt,
      };
      // Coalesce by jobId: BullMQ short-circuits when a job with the same ID
      // is already queued/active/completed and `queue.add` returns the
      // existing job. `waitUntilFinished` on the existing job hands the
      // first run's result to every concurrent caller — exactly what we
      // want when a Telegram webhook is redelivered or the owner sends two
      // messages in <100ms. Callers without a `dispatchOrigin` keep
      // BullMQ's default behaviour (every enqueue is unique).
      const origin: DispatchOrigin | undefined = args.dispatchOrigin;
      const jobId = origin ? buildCoalesceKey(origin) : undefined;
      const jobOpts: JobsOptions = {
        attempts: 3,
        backoff: { delay: 1000, type: "exponential" },
        ...(jobId ? { jobId } : {}),
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      };
      const job = await queue.add("run", payload, jobOpts);
      try {
        const result = (await job.waitUntilFinished(queueEvents, 120_000)) as AgentRunResult;
        return result;
      } catch (error) {
        logger.error(
          {
            agentInstanceId: args.agentInstance.id,
            error,
            jobId: job.id,
            orgId: args.agentInstance.orgId,
          },
          "bullmq-dispatcher.job_failed",
        );
        throw error;
      }
    },
  };

  return {
    close: async () => {
      await queue.close();
      await queueEvents.close();
    },
    dispatcher,
    queue,
  };
};

export { createBullMQDispatcher, QUEUE_NAME };
export type { SerializedAgentJob };
