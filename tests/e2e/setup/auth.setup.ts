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
  const setCookie = signIn.headers()["set-cookie"] ?? "";
  const browserCookies = [];
  for (const part of setCookie.split(/,(?=\s*[\w-]+=)/u)) {
    const [nameValue] = part.split(";");
    const eq = nameValue.indexOf("=");
    if (eq < 0) continue;
    browserCookies.push({
      domain: "localhost",
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
