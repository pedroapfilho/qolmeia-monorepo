/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { TestDatabase } from "#/__tests__/sql-fixture-compat";

declare global {
  // oxlint-disable typescript/consistent-type-definitions
  interface Env {
    DB: TestDatabase;
  }
  namespace Cloudflare {
    interface Env {
      DB: TestDatabase;
    }
  }
  // oxlint-enable typescript/consistent-type-definitions
}
