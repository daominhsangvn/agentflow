import {
  type OrchestratorCaseListItem,
  OrchestratorCaseWaitingFor,
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

describe("AgentCaseList", () => {
  it("lists needs-person cases first with labels", () => {
    render(
      <AgentCaseList
        cases={[
          item({ id: "a", title: "Quiet", sourceKey: "PRO-1" }),
          item({ id: "b", title: "Asking", needsPerson: true }),
        ]}
        isLoading={false}
        nodeLabel="BA"
        onSelect={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId("agent-case-row");
    expect(rows[0]).toHaveTextContent("Asking");
    expect(rows[0]).toHaveTextContent("Needs answer");
    expect(rows[1]).toHaveTextContent("PRO-1");
    expect(rows[1]).toHaveTextContent("Agent tasks");
    expect(screen.getByText("BA · 2 cases")).toBeInTheDocument();
  });

  it("calls onSelect with the case id", async () => {
    const onSelect = vi.fn();
    render(
      <AgentCaseList
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
      <AgentCaseList cases={[]} isLoading nodeLabel="BA" onSelect={vi.fn()} />
    );
    expect(screen.getByTestId("agent-case-loading")).toBeInTheDocument();
    expect(screen.queryByText("No cases yet")).not.toBeInTheDocument();
  });
});
