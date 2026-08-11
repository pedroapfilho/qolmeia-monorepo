import { defineConfig } from "oxlint";
import awesomeness from "oxlint-config-awesomeness";

export default defineConfig({
  extends: [awesomeness],
  options: {
    typeAware: true,
    typeCheck: true,
  },
  overrides: [
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
    {
      files: ["apps/api/src/scripts/**/*.ts"],
      rules: {
        "no-console": "off",
        "unicorn/no-process-exit": "off",
      },
    },
    {
      files: ["apps/agents/src/team/errors.ts"],
      rules: {
        "max-classes-per-file": "off",
      },
    },
    {
      files: ["tests/e2e/**/*.ts"],
      rules: {
        "no-console": "off",
        "require-unicode-regexp": "off",
      },
    },
    {
      files: ["playwright.config.ts"],
      rules: {
        "require-unicode-regexp": "off",
      },
    },
    {
      files: ["playwright.config.ts", "**/next.config.ts"],
      rules: {
        "node/no-sync": "off",
      },
    },
    {
      files: ["apps/agents/src/agents/**/*.ts"],
      rules: {
        "react-hooks/rules-of-hooks": "off",
      },
    },
  ],
});
