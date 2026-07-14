import path from "node:path";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd via Miniflare. D1 migrations are read at config time
// and handed to the pool as a binding; a setup file applies them to each test's
// isolated storage. The LLM is the one mocked seam; see correspondent.test.ts.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        miniflare: {
          bindings: {
            // Deterministic HMAC key so signed-URL tests don't depend on
            // .dev.vars, which is gitignored and absent in CI.
            ASSETS_SIGNING_KEY: "vitest-assets-signing-key",
            TEST_MIGRATIONS: migrations,
          },
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    resolve: {
      alias: { "@": path.join(import.meta.dirname, "src") },
    },
    test: {
      setupFiles: ["./src/__tests__/apply-migrations.ts"],
    },
  };
});
