/**
 * Home (served at /dashboard): org statistics widgets. Every stats route and
 * the agent fleet are stubbed, so the widgets show known values; each widget
 * owns its query, so one failing route leaves the others rendered.
 */

import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  type AgentFleetResponse,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  OrgAttentionKind,
  type OrgAttentionStats,
  type OrgCaseStats,
  type OrgProjectStats,
  type OrgSessionStats,
  OrgStatsPath,
  type OrgUsageStats,
  type OrgWorkflowStats,
} from "@repo/api/src/types/org-stats";
import { getApiBaseUrl } from "./helpers/api-url";
import { requireOrgClaims } from "./helpers/better-auth";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const UI_TIMEOUT_MS = 30_000;
const HOME_URL_RE = /\/dashboard/;
const MEDIAN_ACTIVE_MS = 5_400_000;
const ATTENTION_TITLE = "PRO-12 needs a decision";
const OPEN_CASES = 7;
const RETRY_RE = /retry/i;

test.describe("home", { tag: E2ETag.Smoke }, () => {
  test("shows the statistics widgets and links attention items to the case", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const caseId = randomUUID();
    await stubHome(page, api, { caseId });

    await page.goto(`/${orgSlug}`);
    await expect(page).toHaveURL(HOME_URL_RE, { timeout: UI_TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });

    const cases = page.getByTestId("home-widget-cases");
    await expect(
      cases.getByText(String(OPEN_CASES), { exact: true })
    ).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(cases.getByText("1h 30m").first()).toBeVisible();

    // Unknown cost renders "-", never $0.00.
    const usage = page.getByTestId("home-widget-usage");
    await expect(usage.getByText("Last 7 days")).toBeVisible();
    await expect(usage.getByText("$0.00")).toHaveCount(0);

    await page.getByRole("link", { name: ATTENTION_TITLE }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${orgSlug}/orchestrator/cases/${caseId}`)
    );
  });

  test("a failing usage widget shows its error and retry while cases still render", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    await stubHome(page, api, { caseId: randomUUID(), usageFails: true });

    await page.goto(`/${orgSlug}/dashboard`);
    const usage = page.getByTestId("home-widget-usage");
    await expect(usage.getByText("Couldn't load usage")).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(usage.getByRole("button", { name: RETRY_RE })).toBeVisible();
    await expect(
      page
        .getByTestId("home-widget-cases")
        .getByText(String(OPEN_CASES), { exact: true })
    ).toBeVisible();
  });
});

type HomeStubOptions = { caseId: string; usageFails?: boolean };

async function stubHome(page: Page, api: string, options: HomeStubOptions) {
  const projects: OrgProjectStats = { total: 4, active7d: 2 };
  const workflows: OrgWorkflowStats = {
    total: 5,
    orchestrated: 2,
    process: 3,
    enabled: 4,
    disabled: 1,
  };
  const timeStats = {
    sampleSize: 3,
    medianActiveMs: MEDIAN_ACTIVE_MS,
    totalActiveMs: 10_800_000,
    medianElapsedMs: 86_400_000,
  };
  const cases: OrgCaseStats = {
    open: OPEN_CASES,
    waitingForHuman: 2,
    withBlockedOrFailedTasks: 1,
    closed7d: 3,
    closed30d: 9,
    time7d: timeStats,
    time30d: timeStats,
  };
  const sessions: OrgSessionStats = { last7d: 12, last30d: 40 };
  const usage: OrgUsageStats = {
    last7d: { inputTokens: 1000, outputTokens: 500, costUsd: null },
    last30d: { inputTokens: 4000, outputTokens: 2000, costUsd: null },
    topCases: [],
    topWorkflows: [],
    topProjects: [],
    topAgents: [],
  };
  const attention: OrgAttentionStats = {
    items: [
      {
        kind: OrgAttentionKind.PendingDecision,
        title: ATTENTION_TITLE,
        detail: null,
        caseId: options.caseId,
        computeTargetId: null,
        projectName: "Project",
        workflowName: "Workflow",
        since: new Date().toISOString(),
      },
    ],
    tasks7d: { succeeded: 8, failed: 1, blocked: 1 },
    failedRuns7d: 1,
    guardRefusals7d: 0,
  };
  const fleet: AgentFleetResponse = {
    agents: [
      {
        id: randomUUID(),
        machineName: "runner-1",
        displayName: null,
        kind: AgentKind.Automatic,
        ownerName: null,
        isSharedWithOrg: true,
        isOnline: true,
        lastSeen: new Date().toISOString(),
        health: null,
        claudeCode: {
          reported: "2.1.296 (Claude Code)",
          pinned: "latest",
          status: ClaudeCodeVersionStatus.Latest,
        },
        projects: [],
        enabledWorkflowCount: 1,
      },
    ],
  };

  await stubApiGet(page, api, OrgStatsPath.Projects, projects);
  await stubApiGet(page, api, OrgStatsPath.Workflows, workflows);
  await stubApiGet(page, api, OrgStatsPath.Cases, cases);
  await stubApiGet(page, api, OrgStatsPath.Sessions, sessions);
  await stubApiGet(page, api, OrgStatsPath.Attention, attention);
  await stubApiGet(page, api, "/compute-targets/fleet", fleet);
  if (options.usageFails) {
    await stubApiFailure(page, api, OrgStatsPath.Usage);
  } else {
    await stubApiGet(page, api, OrgStatsPath.Usage, usage);
  }
}

/** Answers GETs of the API's `path` (any query) with `data`, in the API's envelope. */
async function stubApiGet(
  page: Page,
  api: string,
  path: string,
  data: unknown
) {
  const target = new URL(`${api}${path}`);
  await page.route(
    (url) => url.origin === target.origin && url.pathname === target.pathname,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { success: true, data } })
        : route.fallback()
  );
}

async function stubApiFailure(page: Page, api: string, path: string) {
  const target = new URL(`${api}${path}`);
  await page.route(
    (url) => url.origin === target.origin && url.pathname === target.pathname,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 500,
            json: { success: false, error: "Internal error" },
          })
        : route.fallback()
  );
}
