import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkflowsCasesPanel } from "../project-workflows-cases-panel";

type FakeWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
  project: { id: string } | null;
  agent: { mode: WorkflowAgentMode };
};

const mocks = vi.hoisted(() => ({ workflows: [] as unknown[] }));

vi.mock("@repo/app/workflows/hooks/use-workflows", () => ({
  useWorkflows: () => ({ data: mocks.workflows }),
}));

vi.mock("@repo/app/orchestrator/components/org-case-list", () => ({
  OrgCaseList: ({ projectId }: { projectId?: string }) => (
    <div data-project={projectId} data-testid="cases" />
  ),
}));

vi.mock("@repo/app/workflows/components/org-runs-view", () => ({
  OrgRunsView: ({ projectId }: { projectId?: string }) => (
    <div data-project={projectId} data-testid="runs" />
  ),
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function workflow(overrides: Partial<FakeWorkflow>): FakeWorkflow {
  return {
    id: "w1",
    name: "Flow",
    enabled: true,
    project: { id: "p1" },
    agent: { mode: WorkflowAgentMode.Orchestrated },
    ...overrides,
  };
}

describe("ProjectWorkflowsCasesPanel", () => {
  beforeEach(() => {
    mocks.workflows = [];
  });

  it("lists only this project's workflows with mode and enabled badges", () => {
    mocks.workflows = [
      workflow({ id: "w1", name: "Mine" }),
      workflow({
        id: "w2",
        name: "Other",
        project: { id: "p2" },
      }),
      workflow({
        id: "w3",
        name: "Proc",
        enabled: false,
        agent: { mode: WorkflowAgentMode.PlanAndExecute },
      }),
    ];
    render(<ProjectWorkflowsCasesPanel projectId="p1" />);

    expect(screen.getByRole("link", { name: "Mine" })).toHaveAttribute(
      "href",
      "/acme/workflows/w1"
    );
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.getByText("Orchestrated")).toBeInTheDocument();
    expect(screen.getByText("Process")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New workflow" })).toHaveAttribute(
      "href",
      "/acme/workflows/new"
    );
  });

  it("passes the project id to the cases list and shows runs for process workflows", () => {
    mocks.workflows = [
      workflow({ agent: { mode: WorkflowAgentMode.PlanAndExecute } }),
    ];
    render(<ProjectWorkflowsCasesPanel projectId="p1" />);

    expect(screen.getByTestId("cases")).toHaveAttribute("data-project", "p1");
    expect(screen.getByTestId("runs")).toHaveAttribute("data-project", "p1");
  });

  it("hides runs without process workflows", () => {
    mocks.workflows = [workflow({})];
    render(<ProjectWorkflowsCasesPanel projectId="p1" />);

    expect(screen.queryByTestId("runs")).toBeNull();
  });
});
