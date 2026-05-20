import "dotenv/config";

import { env } from "../lib/env";
import { logger } from "../lib/logger";

import { startAgentRunner } from "./agent-runner";

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

const connection = parseRedisUrl(env.REDIS_URL);
const concurrency = Number(process.env.BULLMQ_CONCURRENCY ?? 4);

logger.info({ concurrency, redisHost: connection.host }, "workers.starting");

const worker = startAgentRunner(connection, concurrency);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "workers.shutting_down");
  await worker.close();
  throw new Error(`Process shutdown on ${signal}`);
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

logger.info("workers.ready");
