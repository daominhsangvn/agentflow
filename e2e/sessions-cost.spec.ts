/**
 * Regression: a subscription-only period (API cost $0, subscription $4.20) must
 * show the subscription-inclusive "Est. cost" tile, not "$0", and the Sessions
 * summary no longer has a "PRs Shipped" tile.
 */

import type {
  AgentSessionListResponse,
  AgentSessionUsageSummary,
} from "@repo/api/src/types/agent-session";
import { AgentSessionViewerScope } from "@repo/api/src/types/agent-session";
import { stubApiGet } from "./helpers/api-stubs";
import { getApiBaseUrl } from "./helpers/api-url";
import { requireOrgClaims } from "./helpers/better-auth";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const UI_TIMEOUT_MS = 30_000;
const SUBSCRIPTION_COST = 4.2;
const TOTAL_TOKENS = 600_000;
const EST_COST_VALUE_RE = /\$4\.2/;
const ZERO_COST_RE = /^\$0(\.00)?$/;

test.describe("sessions cost", { tag: E2ETag.Smoke }, () => {
  test("shows the subscription-inclusive estimated cost and no PRs Shipped tile", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const list: AgentSessionListResponse = {
      items: [],
      total: 0,
      viewerScope: AgentSessionViewerScope.Organization,
    };
    const usage: AgentSessionUsageSummary = {
      viewerScope: AgentSessionViewerScope.Organization,
      totalSessions: 12,
      earliestSessionAt: null,
      latestSessionAt: null,
      totalInputTokens: TOTAL_TOKENS - 100_000,
      totalOutputTokens: 100_000,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalEstimatedCost: SUBSCRIPTION_COST,
      subscriptionEstimatedCost: SUBSCRIPTION_COST,
      apiEstimatedCost: 0,
      byUser: [],
      byModel: [],
      byHarness: [],
      byRepository: [],
      lastSyncTargets: [],
    };
    await stubApiGet(page, api, "/agent-sessions", list);
    await stubApiGet(page, api, "/agent-sessions/usage", usage);

    await page.goto(`/${orgSlug}/sessions`);
    await expect(page.getByText("Est. cost").first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    });
    await expect(page.getByText(EST_COST_VALUE_RE).first()).toBeVisible();
    await expect(page.getByText(ZERO_COST_RE)).toHaveCount(0);
    await expect(page.getByText("PRs Shipped")).toHaveCount(0);
  });
});
