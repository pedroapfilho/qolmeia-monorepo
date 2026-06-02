import { defineConfig, devices } from "@playwright/test";

// In CI the apps bind to 0.0.0.0 / Node 18+ resolves `localhost` to `::1`
// via getaddrinfo, and undici doesn't fall back to IPv4 — pin the explicit
// loopback address. Locally we hit the dev ports directly.
const authUrl = process.env.E2E_AUTH_URL ?? "http://127.0.0.1:4000";
const backofficeUrl = process.env.E2E_BACKOFFICE_URL ?? "http://127.0.0.1:3000";
const clientUrl = process.env.E2E_CLIENT_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,

  projects: [
    // Backoffice specs use storage state captured by a setup project so the
    // /protected-routes tests start authenticated. Magic-link specs declare
    // their own clean context with `test.use({ storageState: ... })`.
    { name: "setup", testMatch: /.*\.setup\.ts/v, use: { baseURL: backofficeUrl } },
    {
      dependencies: ["setup"],
      name: "chromium",
      testIgnore: /.*\/auth-email\/.*/v,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
    },
    // auth-email specs seed their own users via the auth API and assert
    // Resend delivery. They intentionally start with a clean cookie jar
    // (no setup dep, no storageState) and target authUrl, not backoffice.
    // This is the dev-friendly path: API-driven, no UI hydration race.
    {
      name: "auth-email",
      testMatch: /.*\/auth-email\/.*/v,
      use: { ...devices["Desktop Chrome"], baseURL: authUrl },
    },
    ...(process.env.CI
      ? []
      : [
          {
            dependencies: ["setup"],
            name: "firefox",
            testIgnore: /.*\/auth-email\/.*/v,
            use: {
              ...devices["Desktop Firefox"],
              storageState: "tests/e2e/.auth/user.json",
            },
          },
          {
            dependencies: ["setup"],
            name: "webkit",
            testIgnore: /.*\/auth-email\/.*/v,
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
    // Default baseURL is the backoffice — most auth surface lives there.
    // Magic-link client specs override with `page.goto(clientUrl + ...)`.
    baseURL: backofficeUrl,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },

  // CI spawns the three servers in parallel. We start them directly from
  // `node_modules/.bin/next` rather than via `pnpm --filter` so the workspace
  // state lock doesn't serialize them — the first wins, the rest hang silently
  // for the full timeout. tsdown's output for apps/auth is `dist/index.mjs`.
  webServer: process.env.CI
    ? [
        {
          command: "node apps/auth/dist/index.mjs",
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
          // /login returns 200 without a session; / would 302 to login (which
          // also 200s, but probing the redirect target is less flaky).
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
