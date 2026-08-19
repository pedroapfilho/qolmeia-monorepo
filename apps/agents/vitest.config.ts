import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/__tests__/worker-entry.ts",
      miniflare: {
        bindings: {
          ASSETS_SIGNING_KEY: "vitest-assets-signing-key",
          INTERNAL_SHARED_SECRET: "vitest-internal-shared-secret-value",
          OPENROUTER_API_KEY: "test-openrouter-key",
          TEST_FIXTURE_SECRET: "vitest-fixture-service-secret-value",
          TEST_FIXTURE_URL: "http://127.0.0.1:4011",
        },
      },
      wrangler: { configPath: "./wrangler.jsonc", environment: "test" },
    }),
  ],
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  test: {
    fileParallelism: false,
    globalSetup: ["../api/src/testing/setup-agents-worker.ts"],
    setupFiles: ["./src/__tests__/apply-migrations.ts"],
    testTimeout: 20_000,
  },
});
