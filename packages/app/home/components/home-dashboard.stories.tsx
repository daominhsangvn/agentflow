import {
  type AgentFleetResponse,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  OrgAttentionKind,
  type OrgAttentionStats,
  type OrgCaseStats,
  type OrgUsageStats,
} from "@repo/api/src/types/org-stats";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import { HomeDashboard } from "./home-dashboard";

const time = {
  sampleSize: 6,
  medianActiveMs: 1_800_000,
  totalActiveMs: 14_400_000,
  medianElapsedMs: 86_400_000,
};
const cases: OrgCaseStats = {
  open: 4,
  waitingForHuman: 2,
  withBlockedOrFailedTasks: 1,
  closed7d: 6,
  closed30d: 21,
  time7d: time,
  time30d: time,
};
const totals = { inputTokens: 1_200_000, outputTokens: 340_000, costUsd: 12.5 };
const usage: OrgUsageStats = {
  last7d: totals,
  last30d: { ...totals, costUsd: null },
  topCases: [{ id: "c1", name: "PRO-1 login", ...totals }],
  topWorkflows: [],
  topProjects: [{ id: "p1", name: "LeaveDesk", ...totals }],
  topAgents: [{ id: "a1", name: "runner-1", ...totals }],
};
const attention: OrgAttentionStats = {
  items: [
    {
      kind: OrgAttentionKind.WaitingForHuman,
      title: "PRO-1 login",
      detail: "Needs approval",
      caseId: "c1",
      computeTargetId: null,
      projectName: "LeaveDesk",
      workflowName: "Delivery",
      since: "2026-10-29T00:00:00.000Z",
    },
  ],
  tasks7d: { succeeded: 9, failed: 1, blocked: 0 },
  failedRuns7d: 1,
  guardRefusals7d: 0,
};
const fleet: AgentFleetResponse = {
  agents: [
    {
      id: "a1",
      machineName: "runner-1",
      displayName: null,
      kind: AgentKind.Automatic,
      ownerName: null,
      isSharedWithOrg: true,
      isOnline: true,
      lastSeen: "2026-10-30T00:00:00.000Z",
      health: null,
      claudeCode: {
        reported: "2.1.296",
        pinned: "2.1.296",
        status: ClaudeCodeVersionStatus.Match,
      },
      projects: [],
      enabledWorkflowCount: 2,
    },
  ],
};

function get(path: string, body: unknown): FixtureRoute {
  return { method: "GET", path, respond: () => body };
}

function routes(overrides: FixtureRoute[] = []): FixtureRoute[] {
  const base = [
    get("/org-stats/projects", { total: 8, active7d: 5 }),
    get("/org-stats/workflows", {
      total: 6,
      orchestrated: 2,
      process: 4,
      enabled: 5,
      disabled: 1,
    }),
    get("/org-stats/cases", cases),
    get("/org-stats/sessions", { last7d: 42, last30d: 180 }),
    get("/org-stats/usage", usage),
    get("/org-stats/attention", attention),
    get("/compute-targets/fleet", fleet),
  ];
  const overridden = new Set(overrides.map((route) => route.path));
  return [...base.filter((route) => !overridden.has(route.path)), ...overrides];
}

const meta: Meta<typeof HomeDashboard> = {
  title: "App Core/Home/Dashboard",
  component: HomeDashboard,
  parameters: { appCore: { apiRoutes: routes() } },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Loading: Story = {
  parameters: {
    appCore: {
      apiRoutes: routes([
        {
          method: "GET",
          path: "/org-stats/usage",
          respond: () => new Promise(() => undefined),
        },
      ]),
    },
  },
};

export const AttentionError: Story = {
  parameters: {
    appCore: {
      apiRoutes: routes([
        {
          method: "GET",
          path: "/org-stats/attention",
          respond: () => null,
          status: 500,
        },
      ]),
    },
  },
};
