import app from "#/app";
import cloudflare from "#/cloudflare";

export default {
  fetch(request, env, ctx): Promise<Response> | Response {
    return app.fetch(request, env, ctx);
  },
  scheduled: cloudflare.scheduled,
} satisfies ExportedHandler<Env>;

export { WorkerJobWorkflow } from "#/cloudflare";
