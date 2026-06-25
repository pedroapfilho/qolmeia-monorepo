import app from "#/app";
import cloudflare from "#/cloudflare";

// Worker entry for vitest-pool-workers and non-Flue wrangler contexts. `flue
// build` generates the production entry from src/app.ts + src/cloudflare.ts +
// src/agents/*; this wraps the SAME app.ts composition with cloudflare.ts's
// scheduled handler + Workflow binding into one ExportedHandler — the exact
// pieces flue build assembles, so the two entries can't drift.
export default {
  fetch(request, env, ctx): Promise<Response> | Response {
    return app.fetch(request, env, ctx);
  },
  scheduled: cloudflare.scheduled,
} satisfies ExportedHandler<Env>;

// Workflow class the runtime binds by name (wrangler.jsonc).
export { WorkerJobWorkflow } from "#/cloudflare";
