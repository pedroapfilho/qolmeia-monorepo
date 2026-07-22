import { expect, test } from "@playwright/test";

import { clientUrl } from "../../../playwright.config";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail } from "../helpers/test-email";

// Skip when Resend isn't configured. The client's magic-link login is the
// ONLY auth surface this app exposes, so without delivery there's nothing
// to assert about beyond "the request returned 200", which is exactly the
// false-positive class this spec exists to prevent.
test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

test.describe("Client magic-link login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("request → email lands → click verify → user lands authenticated on /", async ({
    page,
  }, testInfo) => {
    const since = Date.now();
    const email = makeTestEmail(testInfo);

    // Request a magic link via the client's /login form. The form posts
    // SAME-ORIGIN to /api/auth/sign-in/magic-link (the Next rewrite proxies
    // it to the auth service) with callbackURL set to `${origin}/auth/verify`,
    // then flips the Card into the "check your email" state.
    await page.goto(`${clientUrl}/login`);
    await page.getByLabel(/e-?mail/iu).fill(email);
    await page.getByRole("button", { name: /enviar link mágico|send magic link/iu }).click();
    await expect(page.getByText(/verifique seu e-mail|check your email/iu)).toBeVisible();

    // Assert the magic-link email actually left Resend. This is the
    // primary value of this spec: "the form said 'check your email' but
    // no email ever queued" was the production bug class that triggered
    // this whole suite.
    const mail = await waitForEmail({
      sinceMs: since,
      // Qolmeia ships the magic-link template with subject "Seu link de
      // acesso à Qolmeia"; keep the regex permissive so a copy revision
      // doesn't break the test.
      subject: /link|acesso|magic|sign.?in/iu,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    // The URL points at the CLIENT APP's own origin: the request reached the
    // auth service through the Next rewrite, which forwards x-forwarded-host,
    // so Better Auth's dynamic baseURL derives the requesting app's origin.
    // Clicking it hits /api/auth/magic-link/verify on the client app, the
    // rewrite proxies to the auth service, the session cookie comes back
    // FIRST-PARTY on the client origin, and Better Auth redirects to
    // callbackURL (/auth/verify), which 302s to `/` once a session exists.
    const verifyUrl = extractLink(mail, /\/api\/auth\/magic-link\/verify/u);
    expect(verifyUrl.startsWith(`${clientUrl}/api/auth/magic-link/verify`)).toBe(true);

    await page.goto(verifyUrl);
    // Final landing: chat home. Either the URL ends `/` or the
    // /auth/verify intermediate page redirected to `/`. Use a regex so the
    // assertion survives either landing.
    await page.waitForURL(
      new RegExp(`^${clientUrl.replaceAll(".", String.raw`\.`)}/(\\?.*)?$`, "v"),
    );
    expect(page.url()).not.toContain("/login");
    expect(page.url()).not.toContain("/auth/verify");
  });

  test("error param on /auth/verify renders the failure card instead of redirecting", async ({
    page,
  }) => {
    // Better Auth's magic-link/verify handler redirects to
    // callbackURL?error=<reason> when a token is expired/used/missing.
    // The /auth/verify page should render the error message rather than
    // silently looping back to /login.
    await page.goto(`${clientUrl}/auth/verify?error=expired_token`);
    await expect(page.getByText(/não conseguimos|expirou|expired/iu)).toBeVisible();
    expect(page.url()).toContain("/auth/verify");
  });
});

test.describe("Client login form validation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders the request-link card without a sent state on first load", async ({ page }) => {
    await page.goto(`${clientUrl}/login`);

    await expect(page.getByRole("button", { name: /enviar link mágico/iu })).toBeVisible();
    // The "verifique seu e-mail" state shouldn't be present before a submit.
    await expect(page.getByText(/verifique seu e-mail/iu)).toHaveCount(0);
  });
});
