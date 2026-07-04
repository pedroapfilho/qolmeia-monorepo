import { mkdir } from "node:fs/promises";

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
  await mkdir("tests/e2e/.auth", { recursive: true });

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

  // Sign in via the auth API directly, then thread the cookies into the
  // BrowserContext. The UI-form sign-in path was racy: Playwright's click
  // fired before TanStack Form hydrated, and the browser fell back to a
  // default GET submit (`/login?email=…&password=…`) that never
  // authenticated. UI sign-in is exercised in login.spec.ts; here we just
  // need a valid session in storageState for the dependent specs.
  const signIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { Origin: backofficeUrl },
  });
  expect(signIn.status()).toBe(200);
  // Better Auth issues two cookies (`qolmeia.session_token` +
  // `qolmeia.session_data`). `headers()["set-cookie"]` flattens duplicates
  // into a single comma-joined string and the dot in the cookie name makes
  // re-splitting fragile — use `headersArray()` which preserves multiples.
  const setCookieHeaders = signIn
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  const browserCookies = [];
  for (const part of setCookieHeaders) {
    const [nameValue] = part.split(";");
    const eq = nameValue.indexOf("=");
    if (eq === -1) {
      continue;
    }
    browserCookies.push({
      // Set on the backoffice host so the proxy.ts middleware sees the
      // session when dependent specs hit `${backofficeUrl}/<route>`.
      domain: new URL(backofficeUrl).hostname,
      httpOnly: true,
      name: nameValue.slice(0, eq).trim(),
      path: "/",
      sameSite: "Lax" as const,
      secure: false,
      value: nameValue.slice(eq + 1).trim(),
    });
  }
  await page.context().addCookies(browserCookies);

  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
