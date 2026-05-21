import { type ConnectionOptions, Queue } from "bullmq";

// Single queue for proactive (routine-driven) AgentRuns. Kept separate from
// the inbound agent-run queue so scheduler drift, retries, or backpressure
// in routines never starve reactive Telegram traffic.
const ROUTINE_QUEUE_NAME = "qolmeia-routine-run";

type RoutineJobData = {
  routineId: string;
};

const createRoutineQueue = (connection: ConnectionOptions): Queue<RoutineJobData> =>
  new Queue<RoutineJobData>(ROUTINE_QUEUE_NAME, { connection });

export { createRoutineQueue, ROUTINE_QUEUE_NAME };
export type { RoutineJobData };
