import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { clientUrl } from "../../../playwright.config";

// Client app login — magic-link only (no password field). Submitting flips
// the form into a "check your email" state in the same Card. The next step
// is clicking the URL out of the verification email; this page object just
// owns the "request a link" surface.
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
    await this.page.goto(`${clientUrl}/login`);
  };

  requestLink = async (email: string) => {
    await this.emailInput.fill(email);
    await this.submitButton.click();
  };

  expectSentState = async () => {
    await expect(this.sentHeading).toBeVisible();
  };

  expectErrorToast = async () => {
    await expect(this.errorToast).toBeVisible();
  };
}
