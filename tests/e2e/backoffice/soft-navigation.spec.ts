import { expect, test } from "@playwright/test";

import { backofficeUrl } from "../../../playwright.config";

// The backoffice dashboard is a client-side app-router surface: navigating
// between staff routes must be a soft navigation (the persistent layout shell
// stays mounted, no full document reload).
//
// The dashboard is staff-gated (requireStaff → agents Worker /api/me). CI runs a
// stub for that Worker (tests/e2e/support/agents-stub.mjs) which grants OWNER
// only to requests carrying the `e2e-role=OWNER` marker cookie, so mark this
// context as staff without changing any other spec's non-staff default.
const backofficeRoot = new RegExp(`${backofficeUrl.replaceAll(".", String.raw`\.`)}/$`, "v");

test.describe("Soft navigation", () => {
  test("navigating to the dashboard home keeps the persistent shell without a reload", async ({
    page,
  }) => {
    await page.context().addCookies([{ name: "e2e-role", url: backofficeUrl, value: "OWNER" }]);

    // Start on a sibling staff route, then soft-navigate home.
    await page.goto("/tickets");

    // The sidebar lives in the persistent dashboard layout shell.
    const shell = page.locator('aside[aria-label="Navegação principal"]');
    await expect(shell).toBeVisible();

    // Tag the live document: a full reload replaces it and drops the marker.
    await page.evaluate(() => {
      document.documentElement.dataset.softNavMarker = "1";
    });

    // Scope to the sidebar nav; the sidebar logo also links "/".
    await shell.locator('nav a[href="/"]').click();

    await expect(page).toHaveURL(backofficeRoot);
    await expect(page.getByRole("heading", { name: "Início" })).toBeVisible();

    // Same document ⇒ the router performed a soft navigation, not a reload.
    await expect(page.locator("html")).toHaveAttribute("data-soft-nav-marker", "1");
  });
});
