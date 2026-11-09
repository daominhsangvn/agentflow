import {
  type AgentFleetResponse,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import { AgentFleetTable } from "./agent-fleet-table";

const fleet: AgentFleetResponse = {
  agents: [
    {
      id: "a1",
      machineName: "runner-1",
      displayName: "Dev agent",
      kind: AgentKind.Automatic,
      ownerName: null,
      isSharedWithOrg: true,
      isOnline: true,
      lastSeen: "2026-10-30T00:00:00.000Z",
      health: {
        healthChecked: "2026-10-30T00:00:00.000Z",
        allRequiredPassed: true,
        requiredFailureCount: 0,
      },
      claudeCode: {
        reported: "2.1.296",
        pinned: "2.1.296",
        status: ClaudeCodeVersionStatus.Match,
      },
      projects: [
        {
          id: "p1",
          name: "LeaveDesk",
          commands: ["/dev", "/review"],
          problemCount: 0,
        },
      ],
      enabledWorkflowCount: 2,
    },
    {
      id: "a2",
      machineName: "alice-laptop",
      displayName: null,
      kind: AgentKind.Personal,
      ownerName: "Alice",
      isSharedWithOrg: false,
      isOnline: false,
      lastSeen: "2026-10-28T00:00:00.000Z",
      health: null,
      claudeCode: {
        reported: "2.0.1",
        pinned: "2.1.296",
        status: ClaudeCodeVersionStatus.Mismatch,
      },
      projects: [],
      enabledWorkflowCount: 0,
    },
  ],
};

function fleetRoute(overrides: Partial<FixtureRoute>): FixtureRoute[] {
  return [
    {
      method: "GET",
      path: "/compute-targets/fleet",
      respond: () => fleet,
      ...overrides,
    },
  ];
}

const meta: Meta<typeof AgentFleetTable> = {
  title: "App Core/Compute/Agent Fleet Table",
  component: AgentFleetTable,
  parameters: { appCore: { apiRoutes: fleetRoute({}) } },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Empty: Story = {
  parameters: {
    appCore: { apiRoutes: fleetRoute({ respond: () => ({ agents: [] }) }) },
  },
};

export const LoadError: Story = {
  parameters: {
    appCore: { apiRoutes: fleetRoute({ respond: () => null, status: 500 }) },
  },
};
