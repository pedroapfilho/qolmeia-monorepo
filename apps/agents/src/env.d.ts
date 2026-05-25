// Bindings not declared in wrangler.jsonc — secrets (set via `wrangler secret
// put` / `.dev.vars`) and prod-only resources (Workers AI + Vectorize, added
// to wrangler.jsonc at deploy per P2 T11). Augment the global `Env` so the
// code that references them typechecks; optional fields mean local dev (no
// account) just sees `undefined` and the selector falls through.

// `interface` (not `type`) is required — this declaration merges with the
// global `Env` interface that `wrangler types` generates.
// oxlint-disable-next-line typescript/consistent-type-definitions
interface Env {
  AI?: Ai;
  // Secret used to HMAC-sign /assets/:id URLs. Set via `wrangler secret put
  // ASSETS_SIGNING_KEY` for prod or `.dev.vars` locally.
  ASSETS_SIGNING_KEY: string;
  OPENROUTER_API_KEY: string;
  VECTORIZE?: VectorizeIndex;
}
