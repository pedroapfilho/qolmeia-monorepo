import { backofficeUrl } from "../../../playwright.config";
import { expect, test } from "../fixtures/auth.fixture";

test.describe("Backoffice register", () => {
  test("registers with valid data", async ({ backofficeRegisterPage, page }) => {
    const uniqueEmail = `e2e-reg-${Date.now()}@qolmeia.localhost`;

    await page.context().clearCookies();

    await backofficeRegisterPage.goto();
    await backofficeRegisterPage.register(
      "New User",
      uniqueEmail,
      "SecurePassword1!",
      "SecurePassword1!",
    );

    // Backoffice signup auto-signs the user in and pushes to "/".
    await page.waitForURL(new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v"));
    expect(page.url()).not.toContain("/register");
  });

  test("shows error toast for mismatched passwords", async ({ backofficeRegisterPage, page }) => {
    await page.context().clearCookies();

    await backofficeRegisterPage.goto();
    await backofficeRegisterPage.register(
      "Mismatch User",
      `mismatch-${Date.now()}@qolmeia.localhost`,
      "SecurePassword1!",
      "DifferentPassword!",
    );

    // The form's onSubmit toasts "As senhas não conferem." before even
    // hitting the auth API. Match by toast role rather than wording so a
    // copy change doesn't break the test.
    await backofficeRegisterPage.expectErrorVisible();
    expect(page.url()).toContain("/register");
  });

  test("redirects away from /register when already authenticated", async ({ page }) => {
    // Setup signs in a CUSTOMER-role user — proxy bounces off /register,
    // dashboard layout then bounces off `/`. Either landing is fine; the
    // assertion just pins that /register itself is unreachable for a
    // signed-in session.
    await page.goto("/register");
    await page.waitForURL((url) => !url.pathname.startsWith("/register"));
    expect(page.url()).not.toContain("/register");
  });
});
