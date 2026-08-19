import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { webUrl } from "../../../playwright.config";

export class ClientLoginPage {
  private readonly emailInput: Locator;
  private readonly submitButton: Locator;
  private readonly sentHeading: Locator;
  private readonly errorToast: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByLabel(/e-?mail/iu);
    this.submitButton = page.getByRole("button", { name: /enviar link mágico|send magic link/iu });
    this.sentHeading = page.getByText(/verifique seu e-mail|check your email/iu);
    this.errorToast = page.locator('[data-sonner-toast][data-type="error"]');
  }

  goto = async () => {
    await this.page.goto(`${webUrl}/login`);
  };

  requestLink = async (email: string) => {
    await this.emailInput.pressSequentially(email);
    await this.submitButton.click();
  };

  expectSentState = async () => {
    await expect(this.sentHeading).toBeVisible();
  };

  expectErrorToast = async () => {
    await expect(this.errorToast).toBeVisible();
  };
}
