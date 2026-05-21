import { defineConfig } from "oxlint";
import awesomeness from "oxlint-config-awesomeness";

export default defineConfig({
  extends: [awesomeness],
  overrides: [
    // `new-cap` enforces `new` for PascalCase callables, but several frameworks
    // expose factory functions whose names are PascalCase by convention:
    //   - `Inter` / `Roboto` / etc. from `next/font/google`
    //   - `Scalar` from `@scalar/hono-api-reference`
    // The rule supports an exception list — keep it here (not in awesomeness)
    // because the set is repo-specific.
    {
      files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
      rules: {
        "new-cap": [
          "error",
          {
            capIsNewExceptions: ["Inter", "Scalar"],
          },
        ],
      },
    },
    // `no-console` is on globally because shipping `console.*` to production
    // hides errors from any structured logger. These three files are the
    // exception: they're pre-logger error sinks for unexpected auth/proxy
    // failures (DB down, misconfig). Without a shared logger package, the
    // alternative is silent failure. Drop these overrides once `@repo/observability`
    // (or similar) lands and these files migrate to it.
    {
      files: [
        "apps/web/src/proxy.ts",
        "apps/web/src/lib/auth-helpers.ts",
        "apps/backoffice/src/proxy.ts",
        "apps/backoffice/src/lib/auth-helpers.ts",
        "apps/backoffice/src/components/sign-out-button.tsx",
        "packages/auth/src/server.ts",
      ],
      rules: {
        "no-console": "off",
      },
    },
    // CLI seed scripts are run via tsx directly — they're not production code.
    // `no-console` and `no-process-exit` are inapplicable in this context.
    {
      files: ["apps/api/src/scripts/**/*.ts"],
      rules: {
        "no-console": "off",
        "unicorn/no-process-exit": "off",
      },
    },
  ],
});
