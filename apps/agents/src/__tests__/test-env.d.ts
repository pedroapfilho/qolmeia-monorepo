/// <reference types="@cloudflare/vitest-pool-workers/types" />

import type { TestDatabase } from "#/__tests__/sql-fixture-compat";
import type * as WorkerEntry from "#/__tests__/worker-entry";

declare global {
  // oxlint-disable typescript/consistent-type-definitions
  interface Env {
    DB: TestDatabase;
    TEST_FIXTURE_SECRET: string;
    TEST_FIXTURE_URL: string;
  }
  namespace Cloudflare {
    interface Env {
      DB: TestDatabase;
      TEST_FIXTURE_SECRET: string;
      TEST_FIXTURE_URL: string;
    }
    interface GlobalProps {
      durableNamespaces: "TeamEvents";
      mainModule: typeof WorkerEntry;
    }
  }
  // oxlint-enable typescript/consistent-type-definitions
}
