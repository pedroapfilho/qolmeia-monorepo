/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { D1Migration } from "@cloudflare/vitest-pool-workers";

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
