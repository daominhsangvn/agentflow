/**
 * Org-wide pages: Cases, Runs, Agents, agent detail, Connections and the
 * Skills catalog. Reads are stubbed in the API's envelope so the rows are known.
 */

import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  type AgentDetail,
  type AgentFleetEntry,
  AgentKind,
  AgentWorkKind,
  AgentWorkStatus,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
} from "@repo/api/src/types/orchestrator";
import {
  RunnerCapabilitiesSource,
  RunnerCommandMode,
} from "@repo/api/src/types/runner-capabilities";
import {
  WorkflowRunStatus,
  type WorkflowRunSummary,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { getApiBaseUrl } from "./helpers/api-url";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const UI_TIMEOUT_MS = 30_000;
const CASE_TITLE = "Add leave request approvals";
const COMMAND_DESCRIPTION = "Writes the change and opens a pull request";
const SKILLS_REDIRECT_RE = /\/skills\/command%3A%3Afoo/;
const CLOSED_QUERY_RE = /status=closed/;
const CLAUDE_MISMATCH_RE = /Version mismatch/i;

test.describe("org pages", { tag: E2ETag.Smoke }, () => {
  test("cases lists every case, filters by status and links to the case", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const item = caseItem();
    const requests: string[] = [];
    await page.route(
      (url) =>
        url.href.startsWith(`${api}/orchestrator/cases`) &&
        url.pathname.endsWith("/orchestrator/cases"),
      (route) => {
        if (route.request().method() !== "GET") {
          return route.fallback();
        }
        requests.push(route.request().url());
        return route.fulfill({ json: { success: true, data: [item] } });
      }
    );

    await page.goto(`/${orgSlug}/cases`);
    const row = page.getByRole("row").filter({ hasText: CASE_TITLE });
    await expect(row).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(row.getByText("Project A")).toBeVisible();
    await expect(row.getByText("Workflow A")).toBeVisible();
    await expect(row.getByText("A person's answer")).toBeVisible();

    await page.getByRole("combobox", { name: "Status" }).click();
    await page.getByRole("option", { name: "Closed" }).click();
    await expect
      .poll(() => requests.some((url) => CLOSED_QUERY_RE.test(url)))
      .toBe(true);

    await page.getByRole("link", { name: CASE_TITLE }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${orgSlug}/orchestrator/cases/${item.id}`)
    );
  });

  test("runs lists process runs and links to the run", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const run = runSummary();
    await page.route(`${api}/workflow-runs*`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            json: { success: true, data: { runs: [run], nextCursor: null } },
          })
        : route.fallback()
    );

    await page.goto(`/${orgSlug}/runs`);
    const link = page.getByRole("link", { name: "PRO-7" });
    await expect(link).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(`/${orgSlug}/workflows/${run.workflowId}/runs/${run.id}`)
    );
  });

  test("agents shows the version mismatch and the agent kinds", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const personal = agentEntry({
      kind: AgentKind.Personal,
      machineName: "alice-laptop",
      status: ClaudeCodeVersionStatus.Mismatch,
    });
    const automatic = agentEntry({
      kind: AgentKind.Automatic,
      machineName: "runner-1",
      status: ClaudeCodeVersionStatus.Match,
    });
    await stubApiGet(page, api, "/compute-targets/fleet", {
      agents: [personal, automatic],
    });

    await page.goto(`/${orgSlug}/agents`);
    const fleet = page.getByTestId("agent-fleet");
    await expect(fleet).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(fleet.getByText("pinned 2.1.100")).toBeVisible();
    await expect(
      fleet.getByRole("cell", { name: "Personal", exact: true })
    ).toBeVisible();
    await expect(
      fleet.getByRole("cell", { name: "Automatic", exact: true })
    ).toBeVisible();
  });

  test("agent detail shows header, capabilities, recent tasks and usage", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    const api = getApiBaseUrl();
    const agentId = randomUUID();
    const caseId = randomUUID();
    await stubApiGet(
      page,
      api,
      `/compute-targets/${agentId}/agent-detail`,
      agentDetail(agentId, caseId)
    );

    await page.goto(`/${orgSlug}/agents/${agentId}`);
    const header = page.getByTestId("agent-header");
    await expect(header).toBeVisible({ timeout: UI_TIMEOUT_MS });
    await expect(header.getByText("alice-laptop")).toBeVisible();
    await expect(header.getByText("Personal", { exact: true })).toBeVisible();
    await expect(header.getByText("Owner: Alice")).toBeVisible();
    await expect(header.getByText(CLAUDE_MISMATCH_RE)).toBeVisible();

    const capability = page.getByTestId("capability-file");
    await expect(capability.getByText("implement")).toBeVisible();
    await expect(capability.getByText(COMMAND_DESCRIPTION)).toBeVisible();
    await expect(
      capability.getByText(RunnerCommandMode.Write, { exact: true })
    ).toBeVisible();

    await expect(page.getByTestId("usage-30-days")).toContainText("$1.50");

    await page.getByRole("link", { name: CASE_TITLE }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${orgSlug}/orchestrator/cases/${caseId}`)
    );
  });

  test("a non-UUID agent path redirects to the skills catalog entry", async ({
    apiToken: token,
    page,
  }) => {
    const { orgSlug } = requireOrgClaims(token);
    await page.goto(`/${orgSlug}/agents/command::foo`);
    await expect(page).toHaveURL(SKILLS_REDIRECT_RE, {
      timeout: UI_TIMEOUT_MS,
    });
  });

  test("connections offers Add connection to an admin", async ({
    apiToken: token,
    page,
  }) => {
    const { orgRole, orgSlug } = requireOrgClaims(token);
    expect(isOrgAdminRole(orgRole), "The e2e user must be an org admin").toBe(
      true
    );
    await page.goto(`/${orgSlug}/connections`);
    await expect(
      page.getByRole("button", { name: "Add connection" }).first()
    ).toBeVisible({ timeout: UI_TIMEOUT_MS });
  });

  test("skills renders the catalog", async ({ apiToken: token, page }) => {
    const { orgSlug } = requireOrgClaims(token);
    await page.goto(`/${orgSlug}/skills`);
    await expect(
      page.getByRole("heading", { name: "Skills catalog" })
    ).toBeVisible({ timeout: UI_TIMEOUT_MS });
  });
});

function caseItem(): OrchestratorCaseListItem {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    workflowId: randomUUID(),
    title: CASE_TITLE,
    sourceKey: "PRO-12",
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 0,
    activeTaskCount: 0,
    turnRunning: false,
    taskCount: 2,
    turnCount: 3,
    costUsd: 0.42,
    inputTokens: 1200,
    outputTokens: 300,
    activeMs: 90_000,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    project: { id: randomUUID(), name: "Project A" },
    workflow: { id: randomUUID(), name: "Workflow A" },
    waitingFor: OrchestratorCaseWaitingFor.Human,
    runningAgents: [],
  };
}

function runSummary(): WorkflowRunSummary {
  const now = new Date();
  return {
    id: randomUUID(),
    workflowId: randomUUID(),
    workflowName: "Process workflow",
    triggerId: null,
    triggerType: null,
    status: WorkflowRunStatus.Succeeded,
    source: {
      provider: "jira",
      externalId: "PRO-7",
      key: "PRO-7",
      title: "Fix the build",
      url: null,
    },
    pullRequests: [],
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function agentEntry(input: {
  kind: AgentKind;
  machineName: string;
  status: ClaudeCodeVersionStatus;
}): AgentFleetEntry {
  return {
    id: randomUUID(),
    machineName: input.machineName,
    displayName: null,
    kind: input.kind,
    ownerName: input.kind === AgentKind.Personal ? "Alice" : null,
    isSharedWithOrg: false,
    isOnline: true,
    lastSeen: new Date().toISOString(),
    health: null,
    claudeCode: {
      reported: "2.1.296 (Claude Code)",
      pinned: "2.1.100",
      status: input.status,
    },
    projects: [],
    enabledWorkflowCount: 0,
  };
}

function agentDetail(agentId: string, caseId: string): AgentDetail {
  const window = {
    tasks: 4,
    succeeded: 3,
    failed: 1,
    blocked: 0,
    activeMs: 600_000,
    inputTokens: 5000,
    outputTokens: 2000,
    costUsd: 1.5,
  };
  return {
    agent: {
      ...agentEntry({
        kind: AgentKind.Personal,
        machineName: "alice-laptop",
        status: ClaudeCodeVersionStatus.Mismatch,
      }),
      id: agentId,
    },
    healthTools: [],
    capabilities: [
      {
        projectId: randomUUID(),
        projectName: "Project A",
        source: RunnerCapabilitiesSource.Personal,
        roleName: null,
        commands: [
          {
            name: "implement",
            description: COMMAND_DESCRIPTION,
            mode: RunnerCommandMode.Write,
          },
        ],
        problems: [],
        warnings: [],
        uploaded: new Date().toISOString(),
      },
    ],
    projects: [],
    workflows: [
      {
        id: randomUUID(),
        name: "Workflow A",
        projectId: randomUUID(),
        projectName: "Project A",
        mode: WorkflowAgentMode.Orchestrated,
        roles: [],
      },
    ],
    recentWork: [
      {
        id: randomUUID(),
        kind: AgentWorkKind.Task,
        command: "implement",
        status: AgentWorkStatus.Succeeded,
        caseId,
        caseTitle: CASE_TITLE,
        runId: null,
        workflowId: null,
        label: CASE_TITLE,
        started: new Date().toISOString(),
        finished: new Date().toISOString(),
        activeMs: 120_000,
        inputTokens: 1000,
        outputTokens: 400,
        costUsd: 0.3,
      },
    ],
    usage: { last7d: window, last30d: window },
  };
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
