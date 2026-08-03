import app from "#/app";

// Test-only Worker entry. In production the flue() Vite plugin generates the
// entry (agent Durable Object classes + app.ts's fetch handler), but
// @cloudflare/vitest-pool-workers needs a real module to point `main` at. The
// suite drives HTTP routes and the app-owned Durable Objects, never an agent
// conversation, so the generated FlueCorrespondentV2Agent/FluePlannerV2Agent
// classes are deliberately absent here.
export { TeamEvents, WorkerJobWorkflow } from "#/cloudflare";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
