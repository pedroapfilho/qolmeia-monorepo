import { expect, test } from "../fixtures/auth.fixture";

test.describe("Backoffice password recovery", () => {
  test("submits the recover form and shows a success toast", async ({
    backofficeRecoverPage,
    page,
  }) => {
    await page.context().clearCookies();

    await backofficeRecoverPage.goto();
    await backofficeRecoverPage.requestReset("e2e-test@qolmeia.localhost");

    await backofficeRecoverPage.expectSuccessToast();
    expect(page.url()).toContain("/recover");
  });
});
