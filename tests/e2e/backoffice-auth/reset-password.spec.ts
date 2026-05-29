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

    // The form short-circuits with `toast.error("Link inválido ou expirado.")`
    // when token is empty — no network call goes out.
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

    // Better Auth's `/reset-password` rejects unknown tokens with 400; the
    // form re-toasts the server error message.
    await backofficeResetPasswordPage.expectErrorToast();
    expect(page.url()).toContain("/reset-password");
  });
});
