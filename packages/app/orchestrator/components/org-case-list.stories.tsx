import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
} from "@repo/api/src/types/orchestrator";
import type { Meta, StoryObj } from "@storybook/react";
import type { FixtureRoute } from "../../shared/storybook/fixture-fetch";
import { OrgCaseList } from "./org-case-list";

const cases: OrchestratorCaseListItem[] = [
  {
    id: "01CASE0000000000000000001",
    projectId: "01PROJECT000000000000000",
    workflowId: "01WORKFLOW0000000000000",
    title: "PROJ-7 login fails on Safari",
    sourceKey: "jira:PROJ-7",
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 0,
    activeTaskCount: 1,
    turnRunning: false,
    taskCount: 2,
    turnCount: 3,
    costUsd: 1.37,
    inputTokens: 12_000,
    outputTokens: 3000,
    activeMs: 5_400_000,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:10:00.000Z",
    closedAt: null,
    project: { id: "01PROJECT000000000000000", name: "Web" },
    workflow: { id: "01WORKFLOW0000000000000", name: "Orchestrated" },
    waitingFor: OrchestratorCaseWaitingFor.Tasks,
    runningAgents: ["runner-1"],
    needsPerson: false,
    askedHuman: null,
    agents: [],
  },
  {
    id: "01CASE0000000000000000002",
    projectId: "01PROJECT000000000000000",
    workflowId: "01WORKFLOW0000000000000",
    title: "PROJ-9 export CSV",
    sourceKey: "jira:PROJ-9",
    status: OrchestratorCaseStatus.Closed,
    conversationCount: 1,
    pendingDecisionCount: 0,
    activeTaskCount: 0,
    turnRunning: false,
    taskCount: 1,
    turnCount: 2,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    activeMs: 600_000,
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T09:00:00.000Z",
    closedAt: "2026-10-25T09:00:00.000Z",
    project: { id: "01PROJECT000000000000000", name: "Web" },
    workflow: { id: "01WORKFLOW0000000000000", name: "Orchestrated" },
    waitingFor: OrchestratorCaseWaitingFor.Nothing,
    runningAgents: [],
    needsPerson: false,
    askedHuman: null,
    agents: [],
  },
];

function routes(
  respond: () => unknown,
  status?: number
): { appCore: { apiRoutes: FixtureRoute[] } } {
  return {
    appCore: {
      apiRoutes: [
        { method: "GET", path: "/orchestrator/cases*", respond, status },
        { method: "GET", path: "/projects*", respond: () => [] },
        {
          method: "GET",
          path: "/workflows",
          respond: () => ({ workflows: [] }),
        },
      ],
    },
  };
}

const meta: Meta<typeof OrgCaseList> = {
  title: "App Core/Orchestrator/Org Case List",
  component: OrgCaseList,
  parameters: routes(() => cases),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  parameters: routes(() => []),
};

export const ErrorState: Story = {
  parameters: routes(() => ({ error: "Server error" }), 500),
};
