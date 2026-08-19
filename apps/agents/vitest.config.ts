import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://qolmeia:qolmeia123@localhost:5436/qolmeia?schema=agents_test";
process.env.DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/__tests__/worker-entry.ts",
      miniflare: {
        bindings: {
          ASSETS_SIGNING_KEY: "vitest-assets-signing-key",
          DATABASE_URL: TEST_DATABASE_URL,
        },
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  resolve: {
    alias: { "@": path.join(import.meta.dirname, "src") },
  },
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["pg", "pg-cloudflare", "pg-protocol", "@prisma/adapter-pg"],
          rolldownOptions: {
            external: [
              "assert",
              "crypto",
              "dns",
              "events",
              "fs",
              "net",
              "path",
              "stream",
              "string_decoder",
              "tls",
              "util",
              "util/types",
            ],
          },
        },
      },
    },
    fileParallelism: false,
    globalSetup: ["./src/__tests__/setup-postgres.ts"],
    setupFiles: ["./src/__tests__/apply-migrations.ts"],
    testTimeout: 20_000,
  },
});
