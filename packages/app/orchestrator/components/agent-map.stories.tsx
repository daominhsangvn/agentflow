import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
  type WorkflowAgentMap,
  type WorkflowAgentMapAgent,
} from "@repo/api/src/types/orchestrator";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "storybook/test";
import { AgentMap } from "./agent-map";

function agent(
  id: string,
  overrides: Partial<WorkflowAgentMapAgent> = {}
): WorkflowAgentMapAgent {
  return {
    computeTargetId: id,
    name: id.toUpperCase(),
    isOnline: true,
    role: "Developer",
    kind: AgentKind.Automatic,
    declared: true,
    ...overrides,
  };
}

function makeMap(
  agents: WorkflowAgentMapAgent[],
  withOrchestrator = true
): WorkflowAgentMap {
  return {
    orchestrator: withOrchestrator
      ? { computeTargetId: "orch", name: "Orchestrator", isOnline: true }
      : null,
    agents,
  };
}

function makeCase(
  overrides: Partial<OrchestratorCaseListItem> = {}
): OrchestratorCaseListItem {
  return {
    id: "01CASE0000000000000000001",
    title: "PROJ-7 login fails",
    status: OrchestratorCaseStatus.Open,
    waitingFor: OrchestratorCaseWaitingFor.Tasks,
    needsPerson: false,
    askedHuman: null,
    updatedAt: "2026-10-26T08:10:00.000Z",
    agents: [],
    ...overrides,
  } as OrchestratorCaseListItem;
}

const meta = {
  title: "App Core/Orchestrator/Agent Map",
  component: AgentMap,
  args: {
    map: makeMap([agent("ba")]),
    cases: [],
    selectedNodeId: "orchestrator",
    selectedCase: null,
    onSelect: fn(),
  },
} satisfies Meta<typeof AgentMap>;

export default meta;
type Story = StoryObj<typeof meta>;

const three = makeMap([
  agent("ba", { kind: AgentKind.Personal, role: "BA" }),
  agent("dev"),
  agent("qc", { role: "QC" }),
]);

export const OneAgent: Story = {};

export const ThreeAgents: Story = { args: { map: three } };

export const SevenAgentsWrap: Story = {
  args: {
    map: makeMap(["a", "b", "c", "d", "e", "f", "g"].map((id) => agent(id))),
  },
};

export const OfflineAndNotDeclared: Story = {
  args: {
    map: makeMap([
      agent("ba", { isOnline: false }),
      agent("dev", { declared: false, role: null }),
    ]),
  },
};

export const ActiveTasks: Story = {
  args: {
    map: three,
    cases: [
      makeCase({
        agents: [
          { computeTargetId: "dev", activeTaskCount: 2, openQuestionCount: 0 },
        ],
      }),
    ],
  },
};

export const OpenQuestions: Story = {
  args: {
    map: three,
    cases: [
      makeCase({
        needsPerson: true,
        agents: [
          { computeTargetId: "ba", activeTaskCount: 0, openQuestionCount: 2 },
        ],
      }),
    ],
  },
};

const selected = makeCase({
  needsPerson: true,
  askedHuman: "Which environment should the fix target?",
  agents: [{ computeTargetId: "ba", activeTaskCount: 0, openQuestionCount: 1 }],
});

export const CaseSelected: Story = {
  args: { map: three, cases: [selected], selectedCase: selected },
};

export const WithBanner: Story = {
  args: { map: three, cases: [selected] },
};

export const NoOrchestrator: Story = {
  args: { map: makeMap([agent("ba")], false) },
};

export const Empty: Story = { args: { map: makeMap([]) } };
