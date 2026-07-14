import { expect, test } from "@playwright/test";

import { authUrl } from "../../../playwright.config";
import { verification } from "../fixtures/verification.fixture";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail, makeTestUsername } from "../helpers/test-email";

test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Password reset", () => {
  test("user can request reset, set a new password, and sign in", async ({ request }, testInfo) => {
    const email = makeTestEmail(testInfo);
    const username = makeTestUsername(email);
    const originalPassword = "OriginalPassword1!";
    const newPassword = "BrandNewPassword2!";

    // Seed a user via the API. Bypass verification with the JWT-reconstruction
    // helper; delivery of the *welcome* email isn't under test here. (See
    // sign-up-verification.spec.ts for that assertion.)
    const signUp = await request.post(`${authUrl}/api/auth/sign-up/email`, {
      data: { email, name: "Reset Me", password: originalPassword, username },
    });
    expect([200, 201]).toContain(signUp.status());
    const verify = await verification.forVerifyEmail(email);
    await request.get(verify.url, { failOnStatusCode: false, maxRedirects: 0 });

    // Pin the cutoff AFTER the welcome email was sent so we don't pick it up
    // when looking for the password-reset mail.
    const since = Date.now();

    // Request reset. Better Auth's endpoint is `/request-password-reset`
    // (the older `/forget-password` path was removed). Always returns 200
    // (enumeration prevention) regardless of whether the email exists.
    const reset = await request.post(`${authUrl}/api/auth/request-password-reset`, {
      data: { email, redirectTo: "/reset-password" },
    });
    expect(reset.status()).toBe(200);

    // Assert the reset email actually left Resend: the bug class
    // "we sent a 200 but never delivered" that the old DB-poll path missed.
    const mail = await waitForEmail({
      sinceMs: since,
      subject: /reset/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    // Better Auth builds `${baseURL}/api/auth/reset-password/<token>?callbackURL=…`
    // (token is a path segment). The GET handler validates and redirects to
    // `${callbackURL}?token=…`. We extract the token and call the POST endpoint
    // directly so the test doesn't need a UI reset form.
    const resetUrl = extractLink(mail, /\/api\/auth\/reset-password\/[^"?]+\?callbackURL=/v);
    const token = new URL(resetUrl).pathname.split("/").pop() ?? "";
    expect(token).not.toBe("");

    const resetResponse = await request.post(
      `${authUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`,
      { data: { newPassword } },
    );
    expect(resetResponse.status()).toBe(200);

    // Old password should fail, new password should succeed.
    const oldSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password: originalPassword },
      failOnStatusCode: false,
    });
    expect(oldSignIn.status()).not.toBe(200);

    const newSignIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email, password: newPassword },
    });
    expect(newSignIn.status()).toBe(200);
  });
});
