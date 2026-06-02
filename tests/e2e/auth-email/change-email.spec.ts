import { expect, test } from "@playwright/test";
import { prisma } from "@repo/db";

import { authUrl } from "../../../playwright.config";
import { verification } from "../fixtures/verification.fixture";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail, makeTestUsername } from "../helpers/test-email";

test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Change email (two-stage confirmation + verification)", () => {
  test("user changes email — both stage-1 and stage-2 mails leave Resend, new email signs in", async ({
    request,
  }, testInfo) => {
    const currentEmail = makeTestEmail(testInfo).toLowerCase();
    const newEmail = makeTestEmail(testInfo).toLowerCase().replace("delivered+", "delivered+new-");
    const username = makeTestUsername(currentEmail);
    const password = "ChangeEmailPwd1!";

    // Seed + verify a user, then sign in to get a session. Welcome email
    // isn't under test here; reuse the JWT-reconstruction path.
    const signUp = await request.post(`${authUrl}/api/auth/sign-up/email`, {
      data: { email: currentEmail, name: "Change Me", password, username },
    });
    expect([200, 201]).toContain(signUp.status());
    const verify = await verification.forVerifyEmail(currentEmail);
    await request.get(verify.url, { failOnStatusCode: false, maxRedirects: 0 });

    const signIn = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email: currentEmail, password },
    });
    expect(signIn.status()).toBe(200);

    // Parse Set-Cookie from the sign-in response and forward as Cookie on the
    // change-email call. Playwright's APIRequestContext storage state doesn't
    // include cookies set via API responses, and Better Auth issues two
    // cookies (`qolmeia.session_token` + `qolmeia.session_data`).
    // `headers()["set-cookie"]` flattens duplicates into a single
    // comma-joined string and the dot in the cookie name makes re-splitting
    // fragile — use `headersArray()` which preserves multiples.
    const setCookieHeaders = signIn
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);
    const cookieHeader = setCookieHeaders
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const since = Date.now();

    const change = await request.post(`${authUrl}/api/auth/change-email`, {
      data: { newEmail },
      headers: {
        Cookie: cookieHeader,
        Origin: authUrl,
        Referer: `${authUrl}/`,
      },
    });
    expect(change.status()).toBe(200);

    // Stage 1 — current-mailbox owner consents. Assert the confirmation
    // email landed in Resend's outbox before following it.
    const stage1Mail = await waitForEmail({
      sinceMs: since,
      subject: /confirm|change/i,
      to: currentEmail,
    });
    expect(stage1Mail.last_event).not.toBe("bounced");
    const stage1Url = extractLink(stage1Mail, /\/api\/auth\/verify-email\?token=/v);

    // Stage-1 click — Better Auth's verify-email handler issues stage-2
    // internally (sent to newEmail) and redirects to its callbackURL.
    const stage1Response = await request.get(stage1Url, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(stage1Response.status());

    // Stage 2 — assert the verification mail to the NEW address actually sent.
    const stage2Mail = await waitForEmail({
      sinceMs: since,
      to: newEmail,
    });
    expect(stage2Mail.last_event).not.toBe("bounced");
    const stage2Url = extractLink(stage2Mail, /\/api\/auth\/verify-email\?token=/v);

    // Stage-2 click — proves new-mailbox access and triggers the actual
    // user-record update.
    const stage2Response = await request.get(stage2Url, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(stage2Response.status());

    // DB now reflects the new email. The user row count is unchanged.
    const updated = await prisma.user.findUnique({ where: { email: newEmail } });
    expect(updated).not.toBeNull();
    const stale = await prisma.user.findUnique({ where: { email: currentEmail } });
    expect(stale).toBeNull();

    // Old email no longer authenticates; new email does.
    const oldLogin = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email: currentEmail, password },
      failOnStatusCode: false,
    });
    expect(oldLogin.status()).toBeGreaterThanOrEqual(400);

    const newLogin = await request.post(`${authUrl}/api/auth/sign-in/email`, {
      data: { email: newEmail, password },
    });
    expect(newLogin.status()).toBe(200);
  });
});
