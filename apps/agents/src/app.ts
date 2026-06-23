// Registers the OpenRouter provider on load (side-effect import).
import "#/provider";

import { flue } from "@flue/runtime/routing";

import { createRestApp } from "#/rest-app";

// Flue's HTTP entry, discovered as `app.ts` in the source root. Serves the REST
// surface (shared factory) plus Flue's agent/workflow/run routes. Per-agent auth
// (session + CUSTOMER + tenant) lives in each agent's `route` export. The
// vitest/wrangler entry (src/index.ts) reuses the factory without `flue()`.
const app = createRestApp();
app.route("/", flue());

export default app;
