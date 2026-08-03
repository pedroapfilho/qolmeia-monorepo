/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { TestDatabase } from "#/__tests__/sql-fixture-compat";
import type * as WorkerEntry from "#/__tests__/worker-entry";

declare global {
  // oxlint-disable typescript/consistent-type-definitions
  interface Env {
    DB: TestDatabase;
  }
  namespace Cloudflare {
    interface Env {
      DB: TestDatabase;
    }
    // `wrangler types` derives this from `main`, but wrangler.jsonc no longer
    // has one: the flue() Vite plugin generates the production entry. Declaring
    // it here is what types `exports.default.fetch(...)` across the suite, and
    // it names the module vitest.config.ts actually loads.
    interface GlobalProps {
      durableNamespaces: "TeamEvents";
      mainModule: typeof WorkerEntry;
    }
  }
  // oxlint-enable typescript/consistent-type-definitions
}
