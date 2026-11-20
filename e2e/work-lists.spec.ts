/**
 * Work lists: Runs and Cases show stats above their table, Workflows is a plain
 * index (no tabs), Connections is a table with an admin "Add connection" action.
 * List and summary routes are stubbed so the stats show known values.
 */

import type { Page } from "@playwright/test";
import type { OrchestratorCaseListSummary } from "@repo/api/src/types/orchestrator";
import type {
  WorkflowRunsResponse,
  WorkflowRunsSummary,
} from "@repo/api/src/types/workflow";
import { stubApiGet } from "./helpers/api-stubs";
import { getApiBaseUrl } from "./helpers/api-url";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const UI_TIMEOUT_MS = 30_000;
const RUNS_URL_RE = /\/runs(\?|$)/;
const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to see the Add connection action";
const RUNS_SUMMARY: WorkflowRunsSummary = {
  total: 21,
  active: 3,
  needsYou: 2,
  succeeded: 13,
  failed: 3,
  cancelled: 0,
};
const CASES_SUMMARY: OrchestratorCaseListSummary = {
  total: 17,
  open: 9,
  needsPerson: 4,
  closed: 8,
};
const EMPTY_RUNS: WorkflowRunsResponse = { runs: [], nextCursor: null };

test.describe("work lists", { tag: E2ETag.Smoke }, () => {
  test("runs shows stats and sends the period as startDate", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const summaryStartDates: (string | null)[] = [];
    await stubApiGet(page, api, "/workflow-runs", EMPTY_RUNS);
    await stubApiGet(
      page,
      api,
      "/workflow-runs/summary",
      RUNS_SUMMARY,
      (request) => {
        summaryStartDates.push(
          new URL(request.url()).searchParams.get("startDate")
        );
      }
    );

    await page.goto(`/${orgSlug}/runs`);
    const view = page.getByTestId("org-runs-view");
    await expect(view.getByText("21", { exact: true })).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(view.getByText("13", { exact: true })).toBeVisible();
    expect(summaryStartDates.at(-1)).not.toBeNull();

    const before = summaryStartDates.length;
    const lastStart = summaryStartDates.at(-1);
    await view.getByRole("radio", { name: "Last 7 days" }).click();
    await expect
      .poll(() => summaryStartDates.length, { timeout: UI_TIMEOUT_MS })
      .toBeGreaterThan(before);
    expect(summaryStartDates.at(-1)).not.toBeNull();
    expect(summaryStartDates.at(-1)).not.toBe(lastStart);
  });

  test("cases shows stats and has no period control", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    await stubApiGet(page, api, "/orchestrator/cases", []);
    await stubApiGet(page, api, "/orchestrator/cases/summary", CASES_SUMMARY);

    await page.goto(`/${orgSlug}/cases`);
    const list = page.getByTestId("org-case-list");
    await expect(list.getByText("17", { exact: true })).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(list.getByText("Needs a person")).toBeVisible();
    await expect(page.getByLabel("Date range")).toHaveCount(0);
  });

  test("workflows has no tabs and ?tab=runs lands on runs", async ({
    apiToken: token,
    page,
  }) => {
    const { orgRole, orgSlug } = requireOrgClaims(token);
    await page.goto(`/${orgSlug}/workflows`);
    await expect(page.getByRole("tablist")).toHaveCount(0);
    if (isOrgAdminRole(orgRole)) {
      await expect(
        page.getByRole("link", { name: "New workflow" })
      ).toBeVisible({ timeout: UI_TIMEOUT_MS });
    }

    await stubRunsEmpty(page);
    await page.goto(`/${orgSlug}/workflows?tab=runs`);
    await expect(page).toHaveURL(RUNS_URL_RE, { timeout: UI_TIMEOUT_MS });
  });

  test("connections is a table with an Add connection action", async ({
    apiToken: token,
    page,
  }) => {
    const { orgRole, orgSlug } = requireOrgClaims(token);
    expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

    await page.goto(`/${orgSlug}/connections`);
    await expect(page.getByRole("table")).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(page.getByRole("row").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add connection" }).first()
    ).toBeVisible();
  });
});

async function stubRunsEmpty(page: Page) {
  const api = getApiBaseUrl();
  await stubApiGet(page, api, "/workflow-runs", EMPTY_RUNS);
  await stubApiGet(page, api, "/workflow-runs/summary", RUNS_SUMMARY);
}
