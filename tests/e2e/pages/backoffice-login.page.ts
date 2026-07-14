import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Backoffice login (email/password). UI is Portuguese: labels "E-mail",
// "Senha", submit button "Entrar"/"Entrando...". Root errors render via
// Sonner toast (`toast.error` from @repo/ui/lib/toast).
export class BackofficeLoginPage {
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly rootError: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByLabel(/e-?mail/iu);
    this.passwordInput = page.getByLabel(/senha|password/iu);
    this.submitButton = page.getByRole("button", { name: /entrar|sign in/iu });
    this.rootError = page.locator('[data-sonner-toast][data-type="error"]');
  }

  goto = async () => {
    await this.page.goto("/login");
  };

  login = async (email: string, password: string) => {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  };

  expectErrorVisible = async () => {
    await expect(this.rootError).toBeVisible();
  };
}
