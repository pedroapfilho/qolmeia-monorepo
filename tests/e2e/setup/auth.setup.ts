import { mkdirSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { authUrl, backofficeUrl } from "../../../playwright.config";

const TEST_USER = {
  email: "e2e-test@qolmeia.localhost",
  name: "E2E Test User",
  password: "TestPassword123!",
};

// Seeds a backoffice user once per run and captures the resulting cookie
// jar to disk. Browser projects re-use this storageState so protected-
// route specs start authenticated. Magic-link client specs declare their
// own clean context.
setup("create and authenticate test user", async ({ page, request }) => {
  mkdirSync("tests/e2e/.auth", { recursive: true });

  // Better Auth signup endpoint lives on the auth API (:4000), not on the
  // backoffice Next app. 409/422 (user already exists from a previous run)
  // are also OK — the sign-in below is what we actually validate.
  const signUpResponse = await request.post(`${authUrl}/api/auth/sign-up/email`, {
    data: {
      email: TEST_USER.email,
      name: TEST_USER.name,
      password: TEST_USER.password,
    },
  });
  expect([200, 201, 409, 422]).toContain(signUpResponse.status());

  // Navigate to the backoffice login page and authenticate. The cookie
  // issued by :4000 is host-only (Domain=localhost), so the browser sends
  // it on subsequent navigations to :3000 — that's how the backoffice's
  // Next middleware validates sessions without round-tripping to the auth
  // service for every request.
  await page.goto(`${backofficeUrl}/login`);
  await page.getByLabel(/e-?mail/iv).fill(TEST_USER.email);
  await page.getByLabel(/senha|password/iv).fill(TEST_USER.password);
  await page.getByRole("button", { name: /entrar|sign in/iv }).click();

  // The backoffice dashboard lives at `/`. Wait for the redirect away from
  // /login rather than asserting on a specific heading — the dashboard
  // layout is still in flux and a heading lock-in would make every
  // dashboard reshape a test bug.
  await page.waitForURL(new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v"));

  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
