// Custom Cloudflare exports merged into Flue's generated worker entry — the
// classes wrangler.jsonc binds by name but Flue doesn't generate itself, plus
// non-HTTP Worker handlers. The legacy Worker + Planner DOs are gone; the
// Correspondent DO + the approval Workflow remain until the Correspondent
// surface is fully cut over to Flue.
import { runProactiveSweep } from "#/scheduled";

export { CorrespondentAgent } from "#/agents/correspondent";
export { WorkerJobWorkflow } from "#/workflows/worker-job";

// Weekly proactive "suggest next work" sweep (wrangler.jsonc triggers.crons).
export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runProactiveSweep(env);
  },
};
