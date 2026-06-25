// Non-HTTP exports merged into Flue's generated worker entry, discovered as
// `cloudflare.ts` in the source root: the approval Workflow class (wrangler.jsonc
// binds it by name; Flue doesn't generate it) and the scheduled() handler.
import { runProactiveSweep } from "#/scheduled";

export { WorkerJobWorkflow } from "#/jobs/worker-job";

// Weekly proactive "suggest next work" sweep (wrangler.jsonc triggers.crons).
export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runProactiveSweep(env);
  },
};
