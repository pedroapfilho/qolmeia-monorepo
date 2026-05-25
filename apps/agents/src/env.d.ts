// Secrets are not declared in wrangler.jsonc, so `wrangler types` does not see
// them. Merge them into the generated global `Env` interface here.

// `interface` (not `type`) is required — this declaration merges with the
// global `Env` interface that `wrangler types` generates.
// oxlint-disable-next-line typescript/consistent-type-definitions
interface Env {
  // Set via `wrangler secret put OPENROUTER_API_KEY` (production) or `.dev.vars` (local).
  OPENROUTER_API_KEY: string;
}
