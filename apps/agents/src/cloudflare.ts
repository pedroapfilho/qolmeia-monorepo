import "#/lib/observability";

import { runProactiveSweep } from "#/scheduled";

export { TeamEvents } from "#/durable-objects/team-events";
export { WorkerJobWorkflow } from "#/jobs/worker-job";

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runProactiveSweep(env);
  },
};
