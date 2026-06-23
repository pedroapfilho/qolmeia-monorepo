import { flue } from "@flue/runtime/routing";

import { createRestApp } from "#/app";

// The production worker entry: our REST/webhook surface (shared factory) plus
// Flue's agent / workflow / run routes. Replaces the legacy src/index.ts fetch
// handler. Per-agent access control (session + CUSTOMER + tenant) lives in each
// agent's `route` export, covering the `/agents/:name/:id` paths.
const app = createRestApp();
app.route("/", flue());

export default app;
