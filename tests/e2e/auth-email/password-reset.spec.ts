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

    const signUp = await request.post(`${authUrl}/api/auth/sign-up/email`, {
      data: { email, name: "Reset Me", password: originalPassword, username },
    });
    expect([200, 201]).toContain(signUp.status());
    const verify = await verification.forVerifyEmail(email);
    await request.get(verify.url, { failOnStatusCode: false, maxRedirects: 0 });

    const since = Date.now();

    const reset = await request.post(`${authUrl}/api/auth/request-password-reset`, {
      data: { email, redirectTo: "/reset-password" },
    });
    expect(reset.status()).toBe(200);

    const mail = await waitForEmail({
      sinceMs: since,
      subject: /reset/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    const resetUrl = extractLink(mail, /\/api\/auth\/reset-password\/[^"?]+\?callbackURL=/u);
    const token = new URL(resetUrl).pathname.split("/").pop() ?? "";
    expect(token).not.toBe("");

    const resetResponse = await request.post(
      `${authUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`,
      { data: { newPassword } },
    );
    expect(resetResponse.status()).toBe(200);

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
