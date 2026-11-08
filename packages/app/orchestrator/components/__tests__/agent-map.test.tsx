import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
  OrchestratorTaskStatus,
  type WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentMap } from "../agent-map";

const map: WorkflowAgentMap = {
  orchestrator: { computeTargetId: "orch", name: "Boss", isOnline: true },
  agents: [
    {
      computeTargetId: "ba",
      name: "BA",
      isOnline: true,
      role: "Analyst",
      kind: AgentKind.Personal,
      declared: true,
    },
    {
      computeTargetId: "dev",
      name: "Dev",
      isOnline: false,
      role: null,
      kind: AgentKind.Automatic,
      declared: false,
    },
  ],
};

function makeCase(
  overrides: Partial<OrchestratorCaseListItem> = {}
): OrchestratorCaseListItem {
  return {
    id: "c1",
    title: "Case",
    status: OrchestratorCaseStatus.Open,
    waitingFor: OrchestratorCaseWaitingFor.Human,
    needsPerson: true,
    askedHuman: "Which env?",
    updatedAt: "2026-10-26T08:10:00.000Z",
    agents: [
      {
        computeTargetId: "ba",
        activeTaskCount: 0,
        runningTaskCount: 0,
        queuedTaskCount: 0,
        openQuestionCount: 1,
        latestTaskStatus: null,
        latestTaskError: null,
        latestTaskWaiting: null,
      },
    ],
    ...overrides,
  } as OrchestratorCaseListItem;
}

function agentEntry(
  overrides: Partial<OrchestratorCaseListItem["agents"][number]> = {}
): OrchestratorCaseListItem["agents"][number] {
  return {
    computeTargetId: "ba",
    activeTaskCount: 0,
    runningTaskCount: 0,
    queuedTaskCount: 0,
    openQuestionCount: 1,
    latestTaskStatus: null,
    latestTaskError: null,
    latestTaskWaiting: null,
    ...overrides,
  };
}

function renderMap(props: Partial<Parameters<typeof AgentMap>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <AgentMap
      cases={[makeCase()]}
      map={map}
      onSelect={onSelect}
      selectedCase={null}
      selectedNodeId="orchestrator"
      {...props}
    />
  );
  return onSelect;
}

const RE_0 = /No agents are linked/;
const RE_1 = /^BA,/;
const RE_2 = /^Boss,/;
const RE_3 = /^Boss, orchestrator/;
const RE_4 = /^Dev,/;
const RE_ASKS = /Orchestrator asks/;

describe("AgentMap", () => {
  it("renders pressed state and labels", () => {
    renderMap();
    expect(screen.getByRole("button", { name: RE_3 })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByRole("button", {
        name: "BA, personal agent, online, needs a person",
      })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", {
        name: "Dev, automatic agent, offline, not declared",
      })
    ).toBeInTheDocument();
  });

  it("calls onSelect with the node id", async () => {
    const onSelect = renderMap();
    await userEvent.click(screen.getByRole("button", { name: RE_1 }));
    expect(onSelect).toHaveBeenCalledWith("ba");
    await userEvent.click(screen.getByRole("button", { name: RE_2 }));
    expect(onSelect).toHaveBeenCalledWith("orchestrator");
  });

  it("shows counters", () => {
    renderMap();
    expect(screen.getAllByTestId("agent-map-count")).toHaveLength(1);
    expect(screen.getByTestId("agent-map-needs-person")).toBeInTheDocument();
  });

  it("shows the summed active task count on an agent", () => {
    renderMap({
      cases: [
        makeCase({ agents: [agentEntry({ activeTaskCount: 2 })] }),
        makeCase({
          id: "c2",
          agents: [agentEntry({ activeTaskCount: 1, openQuestionCount: 0 })],
        }),
      ],
    });
    expect(screen.getByTestId("agent-map-task-count")).toHaveTextContent("3");
  });

  it("shows an error icon for a failed latest task in an open case only", () => {
    const failed = agentEntry({
      latestTaskStatus: OrchestratorTaskStatus.Failed,
      latestTaskError: "Loop failed",
      openQuestionCount: 0,
    });
    renderMap({ cases: [makeCase({ agents: [failed], needsPerson: false })] });
    expect(screen.getByTestId("agent-map-error")).toHaveAttribute(
      "title",
      "Loop failed"
    );
  });

  it("ignores a failed task in a closed case", () => {
    const failed = agentEntry({
      latestTaskStatus: OrchestratorTaskStatus.Failed,
      latestTaskError: "Loop failed",
    });
    renderMap({
      cases: [
        makeCase({ agents: [failed], status: OrchestratorCaseStatus.Closed }),
      ],
    });
    expect(screen.queryByTestId("agent-map-error")).not.toBeInTheDocument();
  });

  it("dims agents outside the selected case", () => {
    renderMap({ selectedCase: makeCase() });
    expect(screen.getByRole("button", { name: RE_4 })).toHaveClass(
      "opacity-50"
    );
    expect(screen.getByRole("button", { name: RE_1 })).not.toHaveClass(
      "opacity-50"
    );
  });

  it("shows the asked banner", () => {
    renderMap();
    expect(
      screen.getByText("Orchestrator asks: Which env?")
    ).toBeInTheDocument();
  });

  it("hides the asked banner once the selected case needs no person", () => {
    renderMap({ selectedCase: makeCase({ needsPerson: false }) });
    expect(screen.queryByText(RE_ASKS)).not.toBeInTheDocument();
  });

  it("marks an agent running a task with a moving dashed border, not a moving edge", () => {
    renderMap({
      cases: [
        makeCase({
          agents: [
            {
              computeTargetId: "ba",
              activeTaskCount: 1,
              runningTaskCount: 1,
              queuedTaskCount: 0,
              openQuestionCount: 1,
              latestTaskStatus: null,
              latestTaskError: null,
              latestTaskWaiting: null,
            },
          ],
        }),
      ],
    });
    const edges = screen.getAllByTestId("agent-map-edge");
    const edge = edges.find((el) =>
      el.getAttribute("class")?.includes("stroke-warning")
    );
    expect(edge).toBeDefined();
    for (const each of edges) {
      expect(each.getAttribute("class")).not.toContain("animate");
      expect(each.getAttribute("stroke-dasharray")).toBeNull();
    }
    const working = screen.getAllByTestId("agent-map-working");
    expect(working).toHaveLength(1);
    expect(working[0]?.closest("button")?.getAttribute("aria-label")).toContain(
      "running a task"
    );
    expect(working[0]?.querySelector("rect")?.getAttribute("class")).toContain(
      "animate-edge-flow"
    );
  });

  it("draws no working border for an agent without active tasks", () => {
    renderMap({
      cases: [
        makeCase({
          agents: [
            {
              computeTargetId: "ba",
              activeTaskCount: 0,
              runningTaskCount: 0,
              queuedTaskCount: 0,
              openQuestionCount: 1,
              latestTaskStatus: null,
              latestTaskError: null,
              latestTaskWaiting: null,
            },
          ],
        }),
      ],
    });
    expect(screen.queryByTestId("agent-map-working")).not.toBeInTheDocument();
  });

  it("shows a fallback without an orchestrator and an empty state", () => {
    renderMap({ map: { ...map, orchestrator: null } });
    expect(screen.getByText("No orchestrator agent")).toBeInTheDocument();
  });

  it("renders an empty state without agents", () => {
    renderMap({ map: { orchestrator: null, agents: [] } });
    expect(screen.getByText(RE_0)).toBeInTheDocument();
  });
});
