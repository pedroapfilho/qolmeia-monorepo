import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";
import { extractLink, waitForEmail } from "../helpers/resend";
import { makeTestEmail } from "../helpers/test-email";
import { BackofficeRegisterPage } from "../pages/backoffice-register.page";

test.skip(!process.env.RESEND_API_KEY, "needs RESEND_API_KEY (test mode)");

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Sign-up with redirect context", () => {
  test("?from= survives signup and the verification link carries it back signed in", async ({
    page,
    request,
  }, testInfo) => {
    const since = Date.now();
    const email = makeTestEmail(testInfo);
    const fromPath = "/tickets";

    await page.goto(`${backofficeUrl}/register?from=${encodeURIComponent(fromPath)}`);

    await expect(page.getByRole("link", { name: /entrar|sign in/iu })).toHaveAttribute(
      "href",
      `/login?from=${encodeURIComponent(fromPath)}`,
    );

    const registerPage = new BackofficeRegisterPage(page);
    await registerPage.register("Redirect Me", email, "SecurePassword1!", "SecurePassword1!");

    await expect(page.getByText(/verifique seu e-mail|check your email/iu)).toBeVisible({
      timeout: 10_000,
    });

    const mail = await waitForEmail({
      sinceMs: since,
      subject: /verify|welcome/i,
      to: email,
    });
    expect(mail.last_event).not.toBe("bounced");

    const verifyUrl = extractLink(mail, /\/api\/auth\/verify-email\?token=/u);
    expect(new URL(verifyUrl).searchParams.get("callbackURL")).toBe(`${backofficeUrl}${fromPath}`);

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
