// Secrets are not declared in wrangler.jsonc, so `wrangler types` does not see
// them. Merge them into the generated global `Env` interface here.

interface Env {
  // Set via `wrangler secret put OPENROUTER_API_KEY` (production) or `.dev.vars` (local).
  OPENROUTER_API_KEY: string;
}
