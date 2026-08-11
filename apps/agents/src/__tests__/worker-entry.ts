import app from "#/app";

export { TeamEvents, WorkerJobWorkflow } from "#/cloudflare";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
