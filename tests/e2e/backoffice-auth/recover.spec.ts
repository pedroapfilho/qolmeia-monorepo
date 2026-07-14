import { expect, test } from "../fixtures/auth.fixture";

test.describe("Backoffice password recovery", () => {
  test("submits the recover form and shows a success toast", async ({
    backofficeRecoverPage,
    page,
  }) => {
    await page.context().clearCookies();

    await backofficeRecoverPage.goto();
    await backofficeRecoverPage.requestReset("e2e-test@qolmeia.localhost");

    // Better Auth's `/request-password-reset` always returns 200 (enumeration
    // prevention). The form's `onSubmit` toasts success regardless of whether
    // the email exists; checking the toast is the visible contract here.
    await backofficeRecoverPage.expectSuccessToast();
    expect(page.url()).toContain("/recover");
  });
});
