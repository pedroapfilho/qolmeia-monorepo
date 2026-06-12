import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail } from "../helpers/test-email";
import { BackofficeRegisterPage } from "../pages/backoffice-register.page";

// Skip the whole suite when Resend isn't configured. Without RESEND_API_KEY,
// the auth server runs with requireEmailVerification: false, which is a
// different code path — these tests would assert against the wrong behavior.
test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

// Registration drives the real form, so it needs a clean cookie jar.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-up with redirect context", () => {
  test("?from= survives signup and the verification link carries it back signed in", async ({
    page,
    request,
  }, testInfo) => {
    const since = Date.now();
    const email = makeTestEmail(testInfo);
    const fromPath = "/tickets";

    // Drive the actual form: this is what validates the param and passes it
    // as callbackURL in the signUp.email body (the API would accept any
    // callbackURL — the form wiring is what's under test). The auth-email
    // project's baseURL is the auth service, so target backoffice absolutely.
    await page.goto(`${backofficeUrl}/register?from=${encodeURIComponent(fromPath)}`);

    // The login cross-link carries the context, so switching forms wouldn't
    // drop it.
    await expect(page.getByRole("link", { name: /entrar|sign in/iu })).toHaveAttribute(
      "href",
      `/login?from=${encodeURIComponent(fromPath)}`,
    );

    const registerPage = new BackofficeRegisterPage(page);
    await registerPage.register("Redirect Me", email, "SecurePassword1!", "SecurePassword1!");

    // requireEmailVerification suppresses auto-sign-in: the form shows the
    // inline check-your-email state instead of navigating.
    await expect(page.getByText(/verifique seu e-mail|check your email/iu)).toBeVisible({
      timeout: 10_000,
    });

    const mail = await waitForEmail({
      sinceMs: since,
      subject: /verify|welcome/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    // packages/auth rebuilt the form's relative callbackURL (its ?from=
    // context) against the backoffice origin, so the emailed link carries
    // the absolute /tickets callback — not the app root.
    const verifyUrl = extractLink(mail, /\/api\/auth\/verify-email\?token=/v);
    expect(new URL(verifyUrl).searchParams.get("callbackURL")).toBe(`${backofficeUrl}${fromPath}`);

    // The link IS the login: the verify handler mints a session for the
    // clicking context (autoSignInAfterVerification: true) and 302s to the
    // callback. /tickets is a protected backoffice route — landing there,
    // with the session cookie minted in the same response, proves the
    // clicker is signed in. failOnStatusCode: false because Playwright
    // treats 3xx as failures by default.
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
    expect(new URL(location, backofficeUrl).toString()).toBe(`${backofficeUrl}${fromPath}`);
  });
});
