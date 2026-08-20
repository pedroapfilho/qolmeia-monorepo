import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";

const backofficeRoot = new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v");

test.describe("Instant navigation", () => {
  test("ticket shell renders on initial load", async ({ page }) => {
    await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

    await instant(
      page,
      async () => {
        await page.goto("/tickets");
        await expect(page.locator("aside[aria-hidden]")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
      },
      { baseURL: backofficeUrl },
    );
  });

  const shellHeadings = [
    { heading: "Início", path: "/" },
    { heading: "Atividade", path: "/activity" },
    { heading: "Times", path: "/teams" },
    { heading: "Modelos", path: "/templates" },
    { heading: "Minha cobertura", path: "/cobertura" },
  ] as const;

  for (const { heading, path } of shellHeadings) {
    test(`${path} serves its page heading from the prerendered shell`, async ({ page }) => {
      await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

      await instant(
        page,
        async () => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        },
        { baseURL: backofficeUrl },
      );
    });
  }

  test("the home shell paints its heading while the data areas are still skeletons", async ({
    page,
  }) => {
    await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

    await instant(
      page,
      async () => {
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: "Início" })).toBeVisible();
        await expect(page.getByText("Últimos 7 dias")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Eventos recentes" })).toBeHidden();
      },
      { baseURL: backofficeUrl },
    );
  });

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

    await instant(page, async () => {
      await shell.locator('nav a[href="/"]').click();
      await expect(page).toHaveURL(backofficeRoot);
      await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
    });

    await expect(page.locator("html")).toHaveAttribute("data-soft-nav-marker", "1");
  });
});
