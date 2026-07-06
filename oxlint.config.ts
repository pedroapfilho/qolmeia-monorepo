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
            capIsNewExceptions: ["Inter", "Hanken_Grotesk", "Sora", "JetBrains_Mono", "Scalar"],
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
        "apps/backoffice/src/proxy.ts",
        "apps/backoffice/src/lib/auth-helpers.ts",
        "apps/backoffice/src/components/sign-out-button.tsx",
        "apps/client/src/proxy.ts",
        "apps/client/src/lib/auth-helpers.ts",
        "apps/client/src/components/sign-out-button.tsx",
        "apps/client/src/app/auth/verify/page.tsx",
        "apps/client/src/app/(client)/page.tsx",
        "apps/client/src/app/(client)/assets/page.tsx",
        "apps/client/src/app/(client)/activity/page.tsx",
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
    // errors.ts is a dedicated domain-error registry. Multiple typed Error
    // subclasses in one file is the point — each belongs to the same domain
    // and co-locating them avoids a proliferation of single-class files.
    {
      files: ["apps/agents/src/team/errors.ts"],
      rules: {
        "max-classes-per-file": "off",
      },
    },
    // Playwright's internal selector engine parses regexes passed to
    // `getByLabel`/`getByRole`/`getByText`/`locator(...)` and does NOT support
    // the ES2024 `v` (unicode-sets) flag — it throws a SyntaxError before any
    // test in the project can run. Page objects, fixtures, setup, and specs
    // in `tests/e2e/` use `/iu` instead. Native-JS regexes in helpers
    // (`matchAll`, `replace`, `test`) can still use `v` — the rule only
    // applies here because the `u` form is the safe lowest-common-denominator
    // for the whole tree.
    {
      files: ["tests/e2e/**/*.ts"],
      rules: {
        // The global teardown reports what it deleted (or why it couldn't) —
        // Playwright surfaces stdout/stderr directly; a structured logger
        // adds nothing in test infra.
        "no-console": "off",
        "require-unicode-regexp": "off",
      },
    },
    // These configs resolve portless URLs at module-load time, where async
    // is not an option — `execFileSync` is intentional and bounded (one
    // short-lived subprocess per config load, dev-only).
    {
      files: ["playwright.config.ts", "**/next.config.ts"],
      rules: {
        "node/no-sync": "off",
      },
    },
  ],
});
