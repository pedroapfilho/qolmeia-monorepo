import { expect, test } from "../fixtures/auth.fixture";

test.describe("Backoffice reset-password form", () => {
  test("renders with a token in the query", async ({ backofficeResetPasswordPage, page }) => {
    await page.context().clearCookies();

    await backofficeResetPasswordPage.goto("any-token-value");
    await backofficeResetPasswordPage.expectHeadingVisible();
  });

  test("shows error toast when submitted without a token", async ({
    backofficeResetPasswordPage,
    page,
  }) => {
    await page.context().clearCookies();

    await backofficeResetPasswordPage.goto();
    await backofficeResetPasswordPage.submit("NewPassword123!", "NewPassword123!");

    await backofficeResetPasswordPage.expectErrorToast();
    expect(page.url()).toContain("/reset-password");
  });

  test("rejects an invalid token at the auth server", async ({
    backofficeResetPasswordPage,
    page,
  }) => {
    await page.context().clearCookies();

    await backofficeResetPasswordPage.goto("definitely-not-a-real-token");
    await backofficeResetPasswordPage.submit("ValidPassword123!", "ValidPassword123!");

    await backofficeResetPasswordPage.expectErrorToast();
    expect(page.url()).toContain("/reset-password");
  });
});
