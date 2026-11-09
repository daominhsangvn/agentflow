import {
  type AgentDetail,
  AgentKind,
  AgentWorkflowRole,
  AgentWorkKind,
  AgentWorkStatus,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  RunnerCapabilitiesSource,
  RunnerCommandMode,
} from "@repo/api/src/types/runner-capabilities";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import { AgentDetailView } from "./agent-detail-view";

const window7d = {
  tasks: 12,
  succeeded: 9,
  failed: 2,
  blocked: 1,
  activeMs: 5_400_000,
  inputTokens: 820_000,
  outputTokens: 96_000,
  costUsd: 12.5,
};

const loaded: AgentDetail = {
  agent: {
    id: "a1",
    machineName: "alice-laptop",
    displayName: "Alice's laptop",
    kind: AgentKind.Personal,
    ownerName: "Alice Nguyen",
    isSharedWithOrg: true,
    isOnline: true,
    lastSeen: "2026-10-30T00:00:00.000Z",
    health: {
      healthChecked: "2026-10-29T12:00:00.000Z",
      allRequiredPassed: false,
      requiredFailureCount: 1,
    },
    claudeCode: {
      reported: "2.0.1",
      pinned: "2.1.296",
      status: ClaudeCodeVersionStatus.Mismatch,
    },
    projects: [],
    enabledWorkflowCount: 1,
  },
  healthTools: [
    { id: "git", label: "git", required: true, passed: true, version: "2.45" },
    { id: "gh", label: "gh", required: true, passed: false, version: null },
  ],
  capabilities: [
    {
      projectId: "p1",
      projectName: "LeaveDesk",
      source: RunnerCapabilitiesSource.Toolkit,
      roleName: "Dev",
      commands: [
        {
          name: "/dev",
          args: "<ticket>",
          description: "Implements a ticket",
          mode: RunnerCommandMode.Write,
          needs: ["approved-plan"],
          produces: "code",
          push: true,
        },
        { name: "/review", mode: RunnerCommandMode.Read },
      ],
      problems: [],
      warnings: ["Command /qa is declared but not found"],
      uploaded: "2026-10-29T00:00:00.000Z",
    },
    {
      projectId: "p2",
      projectName: "Calculator",
      source: RunnerCapabilitiesSource.Toolkit,
      roleName: null,
      commands: [
        { name: "/plan", mode: RunnerCommandMode.Read, attach: ["PRD-*.md"] },
      ],
      problems: [],
      warnings: [],
      uploaded: "2026-10-29T00:00:00.000Z",
    },
  ],
  projects: [{ id: "p1", name: "LeaveDesk" }],
  workflows: [
    {
      id: "w1",
      name: "LeaveDesk delivery",
      projectId: "p1",
      projectName: "LeaveDesk",
      mode: WorkflowAgentMode.Orchestrated,
      roles: [AgentWorkflowRole.Orchestrator],
    },
  ],
  recentWork: [
    {
      id: "t1",
      kind: AgentWorkKind.Task,
      command: "/dev",
      status: AgentWorkStatus.Succeeded,
      caseId: "c1",
      caseTitle: "PRO-12 Leave balance",
      runId: null,
      workflowId: null,
      label: "PRO-12",
      started: "2026-10-30T00:00:00.000Z",
      finished: "2026-10-30T00:10:00.000Z",
      activeMs: 600_000,
      inputTokens: 120_000,
      outputTokens: 9000,
      costUsd: 1.2,
    },
    {
      id: "l1",
      kind: AgentWorkKind.RunLoop,
      command: "/review",
      status: AgentWorkStatus.Failed,
      caseId: null,
      caseTitle: null,
      runId: "r1",
      workflowId: "w2",
      label: "Nightly review",
      started: "2026-10-29T00:00:00.000Z",
      finished: null,
      activeMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    },
  ],
  usage: {
    last7d: window7d,
    last30d: { ...window7d, tasks: 40, costUsd: null },
  },
};

function detailRoute(overrides: Partial<FixtureRoute>, data: unknown = loaded) {
  return [
    {
      method: "GET",
      path: "/compute-targets/*/agent-detail",
      respond: () => data,
      ...overrides,
    },
  ];
}

const meta: Meta<typeof AgentDetailView> = {
  title: "App Core/Compute/Agent Detail View",
  component: AgentDetailView,
  args: { agentId: "a1", notFoundHref: "/acme/skills/a1" },
  parameters: { appCore: { apiRoutes: detailRoute({}) } },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const NotChecked: Story = {
  parameters: {
    appCore: {
      apiRoutes: detailRoute(
        {},
        { ...loaded, agent: { ...loaded.agent, health: null }, healthTools: [] }
      ),
    },
  },
};

export const Empty: Story = {
  parameters: {
    appCore: {
      apiRoutes: detailRoute(
        {},
        {
          ...loaded,
          capabilities: [],
          projects: [],
          workflows: [],
          recentWork: [],
          usage: {
            last7d: {
              ...window7d,
              tasks: 0,
              succeeded: 0,
              failed: 0,
              blocked: 0,
            },
            last30d: {
              ...window7d,
              tasks: 0,
              succeeded: 0,
              failed: 0,
              blocked: 0,
            },
          },
        }
      ),
    },
  },
};

export const LoadError: Story = {
  parameters: {
    appCore: { apiRoutes: detailRoute({ respond: () => null, status: 500 }) },
  },
};
