import { expect, test } from "@playwright/test";

import { authUrl } from "../../../playwright.config";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail, makeTestUsername } from "../helpers/test-email";

// Skip the whole suite when Resend isn't configured. Without RESEND_API_KEY,
// the auth server runs with requireEmailVerification: false, which is a
// different code path; these tests would assert against the wrong behavior.
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

    // Pre-verification: signIn fails (Better Auth blocks unverified users
    // when requireEmailVerification is on) and, with sendOnSignIn, re-sends
    // a fresh verification link alongside the 403.
    const preSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password },
      failOnStatusCode: false,
    });
    expect(preSignIn.status()).not.toBe(200);

    // Assert the verification email actually left Resend. This is the
    // regression we care about: "JWT format was valid but the email never
    // sent" silently passed the old reconstruction-based path.
    const mail = await waitForEmail({
      sinceMs: since,
      subject: /verify|welcome/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    // Follow the verification URL with the request fixture (no browser, no
    // hydration race). The link IS the login: Better Auth's verify-email
    // handler accepts the token, mints a session for the clicking context
    // (autoSignInAfterVerification: true) and 302s to the app-root callback.
    // failOnStatusCode: false because Playwright treats 3xx as failures by
    // default.
    const verifyUrl = extractLink(mail, /\/api\/auth\/verify-email\?token=/v);
    const verifyResponse = await request.get(verifyUrl, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(verifyResponse.status()).toBe(302);

    // The clicking context is signed in: the redirect carries the session
    // cookie (name may gain the __Secure- prefix under HTTPS, so match the
    // suffix) and lands on the app root, not a dedicated success page.
    const setCookies = verifyResponse
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    expect(setCookies.some((cookie) => cookie.includes("qolmeia.session_token="))).toBe(true);
    const location = verifyResponse.headers().location;
    expect(location).toBeDefined();
    expect(new URL(location, authUrl).pathname).toBe("/");

    // The email is now verified, so a plain credentials sign-in succeeds too.
    const postSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password },
    });
    expect(postSignIn.status()).toBe(200);
  });
});
