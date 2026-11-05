import { ensureAuthenticatedShellReady } from "./helpers/app-bootstrap";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const RE_SESSIONS_URL = /\/sessions(\?|$)/;
const RE_DASHBOARD_HREF = /\/dashboard$/;
const SIDEBAR_LINKS = [
  "Cases",
  "Sessions",
  "Workflows",
  "Agents",
  "Connections",
];
const REMOVED_SIDEBAR_LABELS = ["Dashboard", "My Tasks", "Documents", "Runs"];
const RE_COMPUTE_PICKER = /^(Compute:|Select target)/;

test.describe("navigation", { tag: E2ETag.Smoke }, () => {
  test("my-tasks page loads and shows sidebar", async ({ page }) => {
    await page.goto("/my-tasks");
    await ensureAuthenticatedShellReady(page);
    await expect(page.getByText("My Tasks").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "All projects", exact: true })
    ).toBeVisible();
    // Loops run on the project's runners, else the organization's: the
    // sidebar no longer has a per-user compute target picker.
    await expect(
      page.getByRole("button", { name: RE_COMPUTE_PICKER })
    ).toHaveCount(0);
  });

  test("sidebar shows Work and Setup groups", async ({ page }) => {
    await page.goto("/dashboard");
    await ensureAuthenticatedShellReady(page);
    const sidebar = page.locator("[data-sidebar=sidebar]").first();
    await expect(sidebar.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      RE_DASHBOARD_HREF
    );
    for (const name of SIDEBAR_LINKS) {
      await expect(
        sidebar.getByRole("link", { name, exact: true })
      ).toBeVisible();
    }
    for (const name of REMOVED_SIDEBAR_LABELS) {
      await expect(sidebar.getByText(name, { exact: true })).toHaveCount(0);
    }
  });

  test("retired loops list forwards to sessions", async ({ page }) => {
    await page.goto("/loops");
    await expect(page).toHaveURL(RE_SESSIONS_URL);
    await ensureAuthenticatedShellReady(page);
  });

  // The notification list itself needs Liveblocks (not ported yet), so only
  // the page shell is asserted here.
  test("inbox page renders without errors", async ({ page }) => {
    await page.goto("/inbox");
    await ensureAuthenticatedShellReady(page);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test("settings page renders tabs", async ({ page }) => {
    await page.goto("/settings");
    await ensureAuthenticatedShellReady(page);
    await expect(page.getByRole("tab").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
