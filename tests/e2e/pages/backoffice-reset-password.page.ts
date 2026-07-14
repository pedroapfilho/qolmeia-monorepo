import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Reset-password: reads `?token=` from query, posts to Better Auth's
// `/reset-password`. CardTitle is rendered as plain text (not a heading
// role), so we match by visible text.
export class BackofficeResetPasswordPage {
  private readonly heading: Locator;
  private readonly passwordInput: Locator;
  private readonly confirmPasswordInput: Locator;
  private readonly submitButton: Locator;
  private readonly errorToast: Locator;
  private readonly successToast: Locator;

  constructor(private readonly page: Page) {
    // Target the CardTitle slot so the locator doesn't collide with the
    // submit button (both render the text "Redefinir senha").
    this.heading = page.locator('[data-slot="card-title"]').filter({
      hasText: /redefinir senha|reset password/iu,
    });
    this.passwordInput = page.getByLabel(/^nova senha$|^new password$/iu);
    this.confirmPasswordInput = page.getByLabel(/confirmar nova senha|confirm.*password/iu);
    this.submitButton = page.getByRole("button", { name: /redefinir senha|reset password/iu });
    this.errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    this.successToast = page.locator('[data-sonner-toast][data-type="success"]');
  }

  goto = async (token?: string) => {
    const path = token ? `/reset-password?token=${encodeURIComponent(token)}` : "/reset-password";
    await this.page.goto(path);
  };

  submit = async (password: string, confirmPassword: string) => {
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.submitButton.click();
  };

  expectHeadingVisible = async () => {
    await expect(this.heading).toBeVisible();
  };

  expectErrorToast = async () => {
    await expect(this.errorToast).toBeVisible();
  };
}
