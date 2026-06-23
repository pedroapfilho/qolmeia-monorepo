// Registers the OpenRouter model provider at module load (imported for its side effect).
import "#/provider";

import { flue } from "@flue/runtime/routing";

import { createRestApp } from "#/rest-app";

// Flue's HTTP entry — discovered as `app.ts` in the source root (src/). Serves
// our REST/webhook surface (shared factory) plus Flue's agent / workflow / run
// routes. Per-agent access control (session + CUSTOMER + tenant) lives in each
// agent's `route` export, covering the `/agents/:name/:id` paths. The
// vitest/wrangler entry (src/index.ts) reuses the same factory without `flue()`.
const app = createRestApp();
app.route("/", flue());

export default app;
