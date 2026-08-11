import { expect, test } from "@playwright/test";

import { authUrl } from "../../../playwright.config";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail, makeTestUsername } from "../helpers/test-email";

test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-up email verification", () => {
  test("verify email is sent, clicking the link signs in the clicking context", async ({
    request,
  }, testInfo) => {
    const since = Date.now();
    const email = makeTestEmail(testInfo);
    const username = makeTestUsername(email);
    const password = "SecurePassword1!";

    const signUp = await request.post(`${authUrl}/api/auth/sign-up/email`, {
      data: { email, name: "Verify Me", password, username },
    });
    expect([200, 201]).toContain(signUp.status());

    const preSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password },
      failOnStatusCode: false,
    });
    expect(preSignIn.status()).not.toBe(200);

    const mail = await waitForEmail({
      sinceMs: since,
      subject: /verify|welcome/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    const verifyUrl = extractLink(mail, /\/api\/auth\/verify-email\?token=/u);
    const verifyResponse = await request.get(verifyUrl, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(verifyResponse.status()).toBe(302);

    const setCookies = verifyResponse
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    expect(setCookies.some((cookie) => cookie.includes("qolmeia.session_token="))).toBe(true);
    const location = verifyResponse.headers().location;
    expect(location).toBeDefined();
    expect(new URL(location, authUrl).pathname).toBe("/");

    const postSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password },
    });
    expect(postSignIn.status()).toBe(200);
  });
});
