/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

// The pool injects the read migrations as the TEST_MIGRATIONS binding (see
// vitest.config.ts), used only by the migration setup file. It is declared
// optional so the production `Env` (which lacks it) still satisfies
// `Cloudflare.Env` — the constraint AIChatAgent<Env> enforces. Both the
// global `Env` and the `Cloudflare.Env` namespace are augmented so the two
// stay structurally aligned.
declare global {
  // oxlint-disable typescript/consistent-type-definitions
  interface Env {
    TEST_MIGRATIONS?: Array<D1Migration>;
  }
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS?: Array<D1Migration>;
    }
  }
  // oxlint-enable typescript/consistent-type-definitions
}
