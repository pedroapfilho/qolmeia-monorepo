import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";

// The backoffice dashboard adopts Next.js 16.3 Instant Navigations. Only the
// home route "/" is instant-enabled (◐); the sibling staff routes opt out with
// `instant = false`. So this drives a soft navigation INTO "/" and asserts the
// prerendered dashboard shell renders without a full reload.
//
// The dashboard is staff-gated (requireStaff → agents Worker /api/me). CI runs a
// stub for that Worker (tests/e2e/support/agents-stub.mjs) which grants OWNER
// only to requests carrying the `e2e-role=OWNER` marker cookie — so mark this
// context as staff without changing any other spec's non-staff default.
const backofficeRoot = new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v");

test.describe("Instant navigation", () => {
  test("navigating to the dashboard home renders the prefetched shell instantly", async ({
    page,
  }) => {
    await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

    // Start on a sibling staff route, then soft-navigate home.
    await page.goto("/tickets");

    // The sidebar lives in the persistent dashboard layout shell.
    const shell = page.locator('aside[aria-label="Navegação principal"]');
    await expect(shell).toBeVisible();

    await instant(page, async () => {
      // Scope to the sidebar nav — the sidebar logo also links "/".
      await shell.locator('nav a[href="/"]').click();

      // Dynamic home data is held until this callback returns, yet the
      // persistent shell is already on screen and the URL is the root — the
      // navigation rendered its shell instantly rather than blocking.
      await expect(shell).toBeVisible();
      await expect(page).toHaveURL(backofficeRoot);
    });

    // Once the instant scope exits, the streamed home content resolves.
    await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();
  });
});
