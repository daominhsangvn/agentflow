import {
  type OrchestratorCaseListItem,
  OrchestratorCaseWaitingFor,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentCaseList } from "../agent-case-list";

function item(
  overrides: Partial<OrchestratorCaseListItem>
): OrchestratorCaseListItem {
  return {
    id: "c1",
    title: "Case",
    sourceKey: null,
    updatedAt: new Date().toISOString(),
    waitingFor: OrchestratorCaseWaitingFor.Tasks,
    needsPerson: false,
    agents: [],
    ...overrides,
  } as unknown as OrchestratorCaseListItem;
}

const agentBase = {
  computeTargetId: "ba",
  activeTaskCount: 0,
  runningTaskCount: 0,
  queuedTaskCount: 0,
  openQuestionCount: 0,
  latestTaskStatus: null,
  latestTaskError: null,
  latestTaskWaiting: null,
};

describe("AgentCaseList", () => {
  it("lists newest first without a needs-answer text", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[
          item({
            id: "a",
            title: "Asking",
            needsPerson: true,
            updatedAt: "2026-01-01T00:00:00Z",
          }),
          item({
            id: "b",
            title: "Quiet",
            sourceKey: "PRO-1",
            updatedAt: "2026-01-02T00:00:00Z",
          }),
        ]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId("agent-case-row");
    expect(rows[0]).toHaveTextContent("PRO-1");
    expect(rows[0]).toHaveTextContent("Agent tasks");
    expect(rows[1]).toHaveTextContent("Asking");
    expect(screen.queryByText("Needs answer")).not.toBeInTheDocument();
    expect(screen.getByText("BA · 2 cases")).toBeInTheDocument();
  });

  it("names a pending decision and hides the waiting text", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[item({ needsPerson: true, pendingDecisionCount: 1 })]}
        isLoading={false}
        nodeLabel="Orchestrator"
        onSelect={vi.fn()}
      />
    );
    const row = screen.getByTestId("agent-case-row");
    expect(screen.getByTestId("agent-case-decision")).toHaveTextContent(
      "Decision pending"
    );
    expect(row).not.toHaveTextContent("Agent tasks");
  });

  it("shows Asked with the question as title", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[item({ needsPerson: true, askedHuman: "Which date?" })]}
        isLoading={false}
        nodeLabel="Orchestrator"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-case-asked")).toHaveAttribute(
      "title",
      "Which date?"
    );
  });

  it("names the asking agent on the orchestrator inbox", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{ ba: "BA" }}
        cases={[
          item({
            needsPerson: true,
            agents: [{ ...agentBase, openQuestionCount: 2 }],
          }),
        ]}
        isLoading={false}
        nodeLabel="Orchestrator"
        onSelect={vi.fn()}
      />
    );
    const badge = screen.getByTestId("agent-case-questions");
    expect(badge).toHaveTextContent("Questions from BA");
    expect(badge).toHaveAttribute("title", "2 questions");
  });

  it("counts the selected agent's questions", () => {
    render(
      <AgentCaseList
        agentId="ba"
        agentNames={{}}
        cases={[
          item({
            needsPerson: true,
            agents: [{ ...agentBase, openQuestionCount: 1 }],
          }),
        ]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-case-questions")).toHaveTextContent(
      "1 question"
    );
  });

  it("shows no person badges when the case does not need a person", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{ ba: "BA" }}
        cases={[
          item({
            agents: [{ ...agentBase, openQuestionCount: 2 }],
          }),
        ]}
        isLoading={false}
        nodeLabel="Orchestrator"
        onSelect={vi.fn()}
      />
    );
    expect(
      screen.queryByTestId("agent-case-questions")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-case-row")).toHaveTextContent(
      "Agent tasks"
    );
  });

  it("calls onSelect with the case id", async () => {
    const onSelect = vi.fn();
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[item({ id: "a" })]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByTestId("agent-case-row"));
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("shows the empty state", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText("No cases yet")).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[]}
        isLoading
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-case-loading")).toBeInTheDocument();
    expect(screen.queryByText("No cases yet")).not.toBeInTheDocument();
  });

  it("shows the agent's task status and icons on its rows", () => {
    const base = agentBase;
    render(
      <AgentCaseList
        agentId="ba"
        agentNames={{}}
        cases={[
          item({
            id: "r",
            agents: [{ ...base, activeTaskCount: 1, runningTaskCount: 1 }],
          }),
          item({
            id: "q",
            agents: [
              {
                ...base,
                activeTaskCount: 1,
                queuedTaskCount: 1,
                latestTaskWaiting: "Runner busy",
              },
            ],
          }),
          item({
            id: "e",
            agents: [
              {
                ...base,
                openQuestionCount: 1,
                latestTaskStatus: OrchestratorTaskStatus.Failed,
                latestTaskError: "Loop failed",
              },
            ],
          }),
        ]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-case-running")).toHaveTextContent(
      "Running"
    );
    expect(screen.getByTestId("agent-case-queued")).toHaveAttribute(
      "title",
      "Runner busy"
    );
    expect(screen.getByTestId("agent-case-failed")).toHaveTextContent("Failed");
    expect(screen.getByTestId("agent-case-failed")).toHaveAttribute(
      "title",
      "Loop failed"
    );
    expect(screen.queryByTestId("agent-case-error")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-case-needs-person")
    ).not.toBeInTheDocument();
  });

  it("adds nothing per row for the orchestrator", () => {
    render(
      <AgentCaseList
        agentId={null}
        agentNames={{}}
        cases={[item({})]}
        isLoading={false}
        nodeLabel="Orchestrator"
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByTestId("agent-case-running")).not.toBeInTheDocument();
  });
});
