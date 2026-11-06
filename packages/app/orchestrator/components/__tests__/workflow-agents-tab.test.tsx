import { AgentKind } from "@repo/api/src/types/agent-fleet";
import type {
  OrchestratorCaseListItem,
  WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORCHESTRATOR_NODE_ID } from "../../lib/agent-counters";
import { WorkflowAgentsTab } from "../workflow-agents-tab";

const BA_ID = "target-ba";

const mocks = vi.hoisted(() => ({
  params: {
    agent: "orchestrator",
    caseId: null as string | null,
    selectAgent: vi.fn(),
    selectCase: vi.fn(),
  },
  map: undefined as WorkflowAgentMap | undefined,
  cases: [] as OrchestratorCaseListItem[],
}));

vi.mock("../../hooks/use-agents-tab-params", () => ({
  useAgentsTabParams: () => mocks.params,
}));
vi.mock("../../hooks/use-workflow-agent-map", () => ({
  useWorkflowAgentMap: () => ({
    data: mocks.map,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useWorkflowAgentCases: () => ({ data: mocks.cases, isLoading: false }),
}));
vi.mock("../agent-map", () => ({
  AgentMap: ({
    selectedNodeId,
    onSelect,
  }: {
    selectedNodeId: string;
    onSelect: (id: string) => void;
  }) => (
    <button onClick={() => onSelect(BA_ID)} type="button">
      map:{selectedNodeId}
    </button>
  ),
}));
vi.mock("../agent-case-list", () => ({
  AgentCaseList: ({
    nodeLabel,
    cases,
  }: {
    nodeLabel: string;
    cases: unknown[];
  }) => (
    <div data-testid="case-list">
      {nodeLabel}:{cases.length}
    </div>
  ),
}));
vi.mock("../agent-case-thread", () => ({
  AgentCaseThread: ({
    caseId,
    node,
  }: {
    caseId: string;
    node: { id: string };
  }) => (
    <div data-testid="thread">
      {caseId}:{node.id}
    </div>
  ),
}));

function makeMap(): WorkflowAgentMap {
  return {
    orchestrator: { computeTargetId: "t-orch", name: "Orch", isOnline: true },
    agents: [
      {
        computeTargetId: BA_ID,
        name: "BA",
        isOnline: true,
        role: null,
        kind: AgentKind.Personal,
        declared: true,
      },
    ],
  };
}

function makeCase(id: string, agentIds: string[]): OrchestratorCaseListItem {
  return {
    id,
    agents: agentIds.map((computeTargetId) => ({
      computeTargetId,
      openQuestionCount: 0,
      activeTaskCount: 0,
    })),
  } as unknown as OrchestratorCaseListItem;
}

describe("WorkflowAgentsTab", () => {
  beforeEach(() => {
    mocks.params.agent = ORCHESTRATOR_NODE_ID;
    mocks.params.caseId = null;
    mocks.params.selectAgent.mockReset();
    mocks.map = makeMap();
    mocks.cases = [makeCase("c1", [BA_ID]), makeCase("c2", [])];
  });

  it("lists every case for the orchestrator", () => {
    render(<WorkflowAgentsTab isAdmin workflowId="w1" />);

    expect(screen.getByTestId("case-list").textContent).toBe("Orch:2");
  });

  it("filters the list to the selected agent", () => {
    mocks.params.agent = BA_ID;
    render(<WorkflowAgentsTab isAdmin workflowId="w1" />);

    expect(screen.getByTestId("case-list").textContent).toBe("BA:1");
  });

  it("falls back to the orchestrator for an unknown agent id", () => {
    mocks.params.agent = "gone";
    render(<WorkflowAgentsTab isAdmin workflowId="w1" />);

    expect(screen.getByText("map:orchestrator")).toBeTruthy();
  });

  it("opens the thread for a deep-linked case", () => {
    mocks.params.agent = BA_ID;
    mocks.params.caseId = "c1";
    render(<WorkflowAgentsTab isAdmin workflowId="w1" />);

    expect(screen.getByTestId("thread").textContent).toBe(`c1:${BA_ID}`);
  });

  it("selects an agent from the map", async () => {
    render(<WorkflowAgentsTab isAdmin workflowId="w1" />);
    await userEvent.click(screen.getByRole("button"));

    expect(mocks.params.selectAgent).toHaveBeenCalledWith(BA_ID);
  });
});
