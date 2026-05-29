import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Recover page — submits to Better Auth's `/request-password-reset`. UI
// shows a Sonner success toast ("Enviamos um link para seu e-mail.") on
// success and an error toast on failure.
export class BackofficeRecoverPage {
  private readonly emailInput: Locator;
  private readonly submitButton: Locator;
  private readonly successToast: Locator;
  private readonly errorToast: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByLabel(/e-?mail/iv);
    this.submitButton = page.getByRole("button", { name: /enviar link|send.*link/iv });
    this.successToast = page.locator('[data-sonner-toast][data-type="success"]');
    this.errorToast = page.locator('[data-sonner-toast][data-type="error"]');
  }

  goto = async () => {
    await this.page.goto("/recover");
  };

  requestReset = async (email: string) => {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  };

  expectSuccessToast = async () => {
    await expect(this.successToast).toBeVisible();
  };

  expectErrorToast = async () => {
    await expect(this.errorToast).toBeVisible();
  };
}
