import { test as base } from "@playwright/test";

import { BackofficeLoginPage } from "../pages/backoffice-login.page";
import { BackofficeRecoverPage } from "../pages/backoffice-recover.page";
import { BackofficeRegisterPage } from "../pages/backoffice-register.page";
import { BackofficeResetPasswordPage } from "../pages/backoffice-reset-password.page";
import { ClientLoginPage } from "../pages/client-login.page";

type Fixtures = {
  backofficeLoginPage: BackofficeLoginPage;
  backofficeRecoverPage: BackofficeRecoverPage;
  backofficeRegisterPage: BackofficeRegisterPage;
  backofficeResetPasswordPage: BackofficeResetPasswordPage;
  clientLoginPage: ClientLoginPage;
};

const test = base.extend<Fixtures>({
  backofficeLoginPage: async ({ page }, use) => {
    await use(new BackofficeLoginPage(page));
  },
  backofficeRecoverPage: async ({ page }, use) => {
    await use(new BackofficeRecoverPage(page));
  },
  backofficeRegisterPage: async ({ page }, use) => {
    await use(new BackofficeRegisterPage(page));
  },
  backofficeResetPasswordPage: async ({ page }, use) => {
    await use(new BackofficeResetPasswordPage(page));
  },
  clientLoginPage: async ({ page }, use) => {
    await use(new ClientLoginPage(page));
  },
});

export { test };
export { expect } from "@playwright/test";
