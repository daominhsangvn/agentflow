import {
  type AgentFleetResponse,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import type {
  OrgCaseStats,
  OrgProjectStats,
  OrgSessionStats,
  OrgWorkflowStats,
} from "@repo/api/src/types/org-stats";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import {
  AgentsWidget,
  CasesWidget,
  ProjectsWidget,
  SessionsWidget,
  WorkflowsWidget,
} from "./home-count-widgets";

function CountWidgets() {
  return (
    <div className="grid grid-cols-3 gap-4">
      <ProjectsWidget />
      <WorkflowsWidget />
      <CasesWidget />
      <SessionsWidget />
      <AgentsWidget />
    </div>
  );
}

const projects: OrgProjectStats = { total: 8, active7d: 5 };
const workflows: OrgWorkflowStats = {
  total: 6,
  orchestrated: 2,
  process: 4,
  enabled: 5,
  disabled: 1,
};
const cases: OrgCaseStats = {
  open: 4,
  waitingForHuman: 2,
  withBlockedOrFailedTasks: 1,
  closed7d: 6,
  closed30d: 21,
  time7d: {
    sampleSize: 6,
    medianActiveMs: 1_800_000,
    totalActiveMs: 14_400_000,
    medianElapsedMs: 86_400_000,
  },
  time30d: {
    sampleSize: 21,
    medianActiveMs: 2_700_000,
    totalActiveMs: 61_200_000,
    medianElapsedMs: 172_800_000,
  },
};
const sessions: OrgSessionStats = { last7d: 42, last30d: 180 };
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

function routes(overrides: Partial<Record<string, FixtureRoute>> = {}) {
  const base: Record<string, FixtureRoute> = {
    projects: {
      method: "GET",
      path: "/org-stats/projects",
      respond: () => projects,
    },
    workflows: {
      method: "GET",
      path: "/org-stats/workflows",
      respond: () => workflows,
    },
    cases: { method: "GET", path: "/org-stats/cases", respond: () => cases },
    sessions: {
      method: "GET",
      path: "/org-stats/sessions",
      respond: () => sessions,
    },
    fleet: {
      method: "GET",
      path: "/compute-targets/fleet",
      respond: () => fleet,
    },
  };
  return Object.values({ ...base, ...overrides }).filter(
    (route): route is FixtureRoute => route !== undefined
  );
}

const meta: Meta<typeof CountWidgets> = {
  title: "App Core/Home/Count Widgets",
  component: CountWidgets,
  parameters: { appCore: { apiRoutes: routes() } },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Loading: Story = {
  parameters: {
    appCore: {
      apiRoutes: routes({
        cases: {
          method: "GET",
          path: "/org-stats/cases",
          respond: () => new Promise(() => undefined),
        },
      }),
    },
  },
};

export const CasesError: Story = {
  parameters: {
    appCore: {
      apiRoutes: routes({
        cases: {
          method: "GET",
          path: "/org-stats/cases",
          respond: () => null,
          status: 500,
        },
      }),
    },
  },
};
