import { execFileSync } from "node:child_process";

import { defineConfig, devices } from "@playwright/test";

const getPortlessUrl = (name: string) => {
  if (process.env.CI) {
    return undefined;
  }
  try {
    return execFileSync("portless", ["get", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

const authUrl =
  process.env.E2E_AUTH_URL ?? getPortlessUrl("qolmeia.api") ?? "http://127.0.0.1:4000";
const backofficeUrl =
  process.env.E2E_BACKOFFICE_URL ?? getPortlessUrl("qolmeia.backoffice") ?? "http://127.0.0.1:3000";
const clientUrl =
  process.env.E2E_CLIENT_URL ?? getPortlessUrl("qolmeia.client") ?? "http://127.0.0.1:3001";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  globalTeardown: "./tests/e2e/teardown/cleanup.ts",

  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/u, use: { baseURL: backofficeUrl } },
    {
      dependencies: ["setup"],
      name: "chromium",
      testIgnore: /.*\/auth-email\/.*/u,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
    },
    {
      name: "auth-email",
      testMatch: /.*\/auth-email\/.*/u,
      use: { ...devices["Desktop Chrome"], baseURL: authUrl },
    },
    ...(process.env.CI
      ? []
      : [
          {
            dependencies: ["setup"],
            name: "firefox",
            testIgnore: /.*\/auth-email\/.*/u,
            use: {
              ...devices["Desktop Firefox"],
              storageState: "tests/e2e/.auth/user.json",
            },
          },
          {
            dependencies: ["setup"],
            name: "webkit",
            testIgnore: /.*\/auth-email\/.*/u,
            use: {
              ...devices["Desktop Safari"],
              storageState: "tests/e2e/.auth/user.json",
            },
          },
        ]),
  ],

  reporter: process.env.CI ? [["html", { open: "never" }]] : [["list"], ["html"]],
  retries: process.env.CI ? 2 : 0,
  testDir: "./tests/e2e",

  use: {
    baseURL: backofficeUrl,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  webServer: process.env.CI
    ? [
        {
          command: "node tests/e2e/support/agents-stub.mjs",
          stderr: "pipe",
          stdout: "pipe",
          timeout: 30_000,
          url: "http://127.0.0.1:8787/healthz",
        },
        {
          command: "node apps/api/dist/index.mjs",
          env: {
            HOST: "127.0.0.1",
            PORT: "4000",
          },
          stderr: "pipe",
          stdout: "pipe",
          timeout: 120_000,
          url: `${authUrl}/healthz`,
        },
        {
          command: "node_modules/.bin/next start apps/backoffice --port 3000 --hostname 127.0.0.1",
          stderr: "pipe",
          stdout: "pipe",
          timeout: 120_000,
          url: `${backofficeUrl}/login`,
        },
        {
          command: "node_modules/.bin/next start apps/client --port 3001 --hostname 127.0.0.1",
          stderr: "pipe",
          stdout: "pipe",
          timeout: 120_000,
          url: `${clientUrl}/login`,
        },
      ]
    : [],

  workers: process.env.CI ? 1 : undefined,
});

export { authUrl, backofficeUrl, clientUrl };
