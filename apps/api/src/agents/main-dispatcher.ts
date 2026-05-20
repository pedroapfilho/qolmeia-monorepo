import { env } from "../lib/env";
import { logger } from "../lib/logger";

import { createBullMQDispatcher } from "./bullmq-dispatcher";
import { createSerialDispatcher } from "./dispatcher";
import type { AgentDispatcher } from "./dispatcher";
import { runAgentInstance } from "./runtime";

const createDispatcher = (): AgentDispatcher => {
  if (env.DISPATCH_MODE === "queue") {
    const bullmq = createBullMQDispatcher();
    logger.info({ mode: "queue" }, "dispatcher.initialized");
    return bullmq.dispatcher;
  }
  logger.info({ mode: "serial" }, "dispatcher.initialized");
  return createSerialDispatcher(runAgentInstance);
};

const dispatcher: AgentDispatcher = createDispatcher();

export { dispatcher };
