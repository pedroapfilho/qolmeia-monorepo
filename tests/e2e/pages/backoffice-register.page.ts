import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Backoffice register — fields Nome, E-mail, Senha, Confirmar senha;
// submit "Criar conta"/"Criando conta...". Validation errors surface via
// FieldError inside TanStack Form; root errors via Sonner.
export class BackofficeRegisterPage {
  private readonly nameInput: Locator;
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly confirmPasswordInput: Locator;
  private readonly submitButton: Locator;
  private readonly rootError: Locator;

  constructor(private readonly page: Page) {
    this.nameInput = page.getByLabel(/^nome$|^name$/iv);
    this.emailInput = page.getByLabel(/e-?mail/iv);
    this.passwordInput = page.getByLabel(/^senha$|^password$/iv);
    this.confirmPasswordInput = page.getByLabel(/confirmar senha|confirm password/iv);
    this.submitButton = page.getByRole("button", { name: /criar conta|create account/iv });
    this.rootError = page.locator('[data-sonner-toast][data-type="error"]');
  }

  goto = async () => {
    await this.page.goto("/register");
  };

  register = async (name: string, email: string, password: string, confirmPassword: string) => {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword);
    await this.submitButton.click();
  };

  expectErrorVisible = async () => {
    await expect(this.rootError).toBeVisible();
  };
}
