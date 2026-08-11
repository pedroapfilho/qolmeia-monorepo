import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";

const backofficeRoot = new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v");

test.describe("Soft navigation", () => {
  test("navigating to the dashboard home keeps the persistent shell without a reload", async ({
    page,
  }) => {
    await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

    await page.goto("/tickets");

    const shell = page.locator('aside[aria-label="Navegação principal"]');
    await expect(shell).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.dataset.softNavMarker = "1";
    });

    await shell.locator('nav a[href="/"]').click();

    await expect(page).toHaveURL(backofficeRoot);
    await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

    await expect(page.locator("html")).toHaveAttribute("data-soft-nav-marker", "1");
  });
});
