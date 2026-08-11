import { mkdir } from "node:fs/promises";

import { expect, test as setup } from "@playwright/test";

import { authUrl, backofficeUrl } from "../../../playwright.config";

const TEST_USER = {
  email: "e2e-test@qolmeia.localhost",
  name: "E2E Test User",
  password: "TestPassword123!",
};

setup("create and authenticate test user", async ({ page, request }) => {
  await mkdir("tests/e2e/.auth", { recursive: true });

  const signUpResponse = await request.post(`${authUrl}/api/auth/sign-up/email`, {
    data: {
      email: TEST_USER.email,
      name: TEST_USER.name,
      password: TEST_USER.password,
    },
  });
  expect([200, 201, 409, 422]).toContain(signUpResponse.status());

  const signIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { Origin: backofficeUrl },
  });
  expect(signIn.status()).toBe(200);
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
