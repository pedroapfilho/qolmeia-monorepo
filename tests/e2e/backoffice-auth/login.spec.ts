import { backofficeUrl } from "../../../playwright.config";
import { expect, test } from "../fixtures/auth.fixture";

const TEST_USER = {
  email: "e2e-test@qolmeia.localhost",
  password: "TestPassword123!",
};

test.describe("Backoffice login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("logs in with valid credentials", async ({ backofficeLoginPage, page }) => {
    await backofficeLoginPage.goto();
    await backofficeLoginPage.login(TEST_USER.email, TEST_USER.password);

    // Dashboard is at `/`. Wait for the redirect off /login rather than
    // pinning to a specific dashboard surface.
    await page.waitForURL(new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v"));
    expect(page.url()).not.toContain("/login");
  });

  test("shows error toast for wrong password", async ({ backofficeLoginPage, page }) => {
    await backofficeLoginPage.goto();
    await backofficeLoginPage.login(TEST_USER.email, "WrongPassword!!");

    await backofficeLoginPage.expectErrorVisible();
    expect(page.url()).toContain("/login");
  });
});

test.describe("Backoffice login (already authenticated)", () => {
  test("redirects away from /login when already authenticated", async ({ page }) => {
    // The setup project signs in a CUSTOMER-role user. The proxy redirects
    // authenticated users away from `/login`; the dashboard layout then
    // bounces non-staff users to `/no-access`. Either way, the user must
    // not stay on `/login` — that's what this test pins.
    await page.goto("/login");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    expect(page.url()).not.toContain("/login");
  });
});
