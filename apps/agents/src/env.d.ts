// Bindings not declared in wrangler.jsonc — secrets (set via `wrangler secret
// put` / `.dev.vars`) and prod-only resources (Workers AI + Vectorize, added
// to wrangler.jsonc at deploy per P2 T11). `wrangler types` only emits secret
// keys it can read from `.dev.vars`, which is git-ignored and absent in CI —
// so a clean checkout generates an `Env` without them and typecheck breaks.
// Declare them here instead. Both the global `Env` and `Cloudflare.Env` are
// augmented (the constraint `AIChatAgent<Env>` enforces `Cloudflare.Env`), and
// the two must stay structurally aligned. Optional fields mean local dev (no
// account) just sees `undefined` and the selector falls through.

// `interface` (not `type`) is required — these declarations merge with the
// interfaces `wrangler types` generates.
// oxlint-disable typescript/consistent-type-definitions
interface Env {
  AI?: Ai;
  // Secret used to HMAC-sign /assets/:id URLs. Set via `wrangler secret put
  // ASSETS_SIGNING_KEY` for prod or `.dev.vars` locally.
  ASSETS_SIGNING_KEY: string;
  // Exa web-search API key (https://exa.ai). Optional — the webSearch skill
  // throws a clear error when it's unset rather than running keyless.
  EXA_API_KEY?: string;
  // Firecrawl for the fetchUrl skill (reads a webpage as markdown).
  // FIRECRAWL_BASE_URL defaults to the cloud (https://api.firecrawl.dev), which
  // needs FIRECRAWL_API_KEY; point it at a self-hosted instance to run keyless.
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_BASE_URL?: string;
  OPENROUTER_API_KEY: string;
  // Shared secret with apps/auth gating the /api/internal/* relay.
  INTERNAL_SHARED_SECRET: string;
  VECTORIZE?: VectorizeIndex;
}

namespace Cloudflare {
  // Intentionally mirrors the global `Env` above — the `AIChatAgent<Env>`
  // constraint resolves against `Cloudflare.Env`, so the two must match.
  // oxlint-disable-next-line no-shadow
  interface Env {
    AI?: Ai;
    ASSETS_SIGNING_KEY: string;
    EXA_API_KEY?: string;
    FIRECRAWL_API_KEY?: string;
    FIRECRAWL_BASE_URL?: string;
    OPENROUTER_API_KEY: string;
    INTERNAL_SHARED_SECRET: string;
    VECTORIZE?: VectorizeIndex;
  }
}
// oxlint-enable typescript/consistent-type-definitions
