import { runProactiveSweep } from "#/scheduled";

export { WorkerJobWorkflow } from "#/jobs/worker-job";

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runProactiveSweep(env);
  },
};
