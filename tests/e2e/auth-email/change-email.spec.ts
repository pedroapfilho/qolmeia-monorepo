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

    const stage1Mail = await waitForEmail({
      sinceMs: since,
      subject: /confirm|change/i,
      to: currentEmail,
    });
    expect(stage1Mail.last_event).not.toBe("bounced");
    const stage1Url = extractLink(stage1Mail, /\/api\/auth\/verify-email\?token=/u);

    const stage1Response = await request.get(stage1Url, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(stage1Response.status());

    const stage2Mail = await waitForEmail({
      sinceMs: since,
      to: newEmail,
    });
    expect(stage2Mail.last_event).not.toBe("bounced");
    const stage2Url = extractLink(stage2Mail, /\/api\/auth\/verify-email\?token=/u);

    const stage2Response = await request.get(stage2Url, {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect([200, 302]).toContain(stage2Response.status());

    const updated = await prisma.user.findUnique({ where: { email: newEmail } });
    expect(updated).not.toBeNull();
    const stale = await prisma.user.findUnique({ where: { email: currentEmail } });
    expect(stale).toBeNull();

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
