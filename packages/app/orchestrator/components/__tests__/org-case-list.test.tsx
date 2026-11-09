import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
} from "@repo/api/src/types/orchestrator";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgCaseList } from "../org-case-list";

const RETRY_RE = /retry|try again/i;

const mocks = vi.hoisted(() => ({
  cases: {
    data: undefined as OrchestratorCaseListItem[] | undefined,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  useOrgCases: vi.fn(),
}));

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useOrgOrchestratorCases: (query: unknown) => {
    mocks.useOrgCases(query);
    return mocks.cases;
  },
  isCaseActive: (c: { turnRunning: boolean; activeTaskCount: number }) =>
    c.turnRunning || c.activeTaskCount > 0,
}));

vi.mock("@repo/app/projects/hooks/use-projects", () => ({
  useProjects: () => ({ data: [{ id: "p1", name: "Web" }] }),
}));

vi.mock("@repo/app/workflows/hooks/use-workflows", () => ({
  useWorkflows: () => ({
    data: [
      {
        id: "w1",
        name: "Orchestrated flow",
        project: { id: "p1", name: "Web" },
        agent: { mode: WorkflowAgentMode.Orchestrated },
      },
      {
        id: "w2",
        name: "Process flow",
        project: { id: "p1", name: "Web" },
        agent: { mode: WorkflowAgentMode.PlanAndExecute },
      },
    ],
  }),
}));

// Radix Select does not open in jsdom: swap in a native select.
vi.mock("@repo/design-system/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      onChange={(event) => onValueChange(event.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

function item(
  overrides: Partial<OrchestratorCaseListItem> = {}
): OrchestratorCaseListItem {
  return {
    id: "case-1",
    projectId: "p1",
    workflowId: "w1",
    title: "PROJ-7 login bug",
    sourceKey: "jira:PROJ-7",
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 0,
    activeTaskCount: 0,
    turnRunning: false,
    taskCount: 2,
    turnCount: 3,
    costUsd: 0.42,
    inputTokens: 1000,
    outputTokens: 500,
    activeMs: 5_400_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T03:00:00.000Z",
    project: { id: "p1", name: "Web" },
    workflow: { id: "w1", name: "Orchestrated flow" },
    waitingFor: OrchestratorCaseWaitingFor.Tasks,
    runningAgents: ["runner-1"],
    needsPerson: false,
    askedHuman: null,
    agents: [],
    ...overrides,
  };
}

describe("OrgCaseList", () => {
  beforeEach(() => {
    mocks.cases.data = undefined;
    mocks.cases.isLoading = false;
    mocks.cases.error = null;
    mocks.cases.refetch.mockReset();
    mocks.useOrgCases.mockReset();
  });

  it("renders project, workflow, waiting label and agents", () => {
    mocks.cases.data = [item()];
    render(<OrgCaseList />);

    expect(
      screen.getByRole("link", { name: "PROJ-7 login bug" })
    ).toHaveAttribute("href", "/acme/orchestrator/cases/case-1");
    expect(screen.getByText("Web", { selector: "td" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Orchestrated flow" })
    ).toHaveAttribute("href", "/acme/workflows/w1?tab=cases");
    expect(screen.getByText("Agent tasks")).toBeTruthy();
    expect(screen.getByText("runner-1")).toBeTruthy();
  });

  it("shows active time with an elapsed line, and the token total", () => {
    mocks.cases.data = [item()];
    render(<OrgCaseList />);

    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.getByText("elapsed 3h 0m")).toBeTruthy();
    expect(screen.getByText("1.50k")).toBeTruthy();
  });

  it("renders a dash for a null cost and $0.00 for a zero cost", () => {
    mocks.cases.data = [
      item({ id: "a", costUsd: null }),
      item({ id: "b", costUsd: 0 }),
    ];
    render(<OrgCaseList />);

    expect(screen.getByText("-", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("$0.00")).toBeTruthy();
  });

  it("sends the status filter with the request", async () => {
    mocks.cases.data = [item()];
    render(<OrgCaseList />);

    await userEvent.selectOptions(
      screen.getAllByRole("combobox")[2] as HTMLElement,
      OrchestratorCaseStatus.Closed
    );

    expect(mocks.useOrgCases).toHaveBeenLastCalledWith({
      projectId: undefined,
      workflowId: undefined,
      status: OrchestratorCaseStatus.Closed,
    });
  });

  it("offers only orchestrated workflows", () => {
    mocks.cases.data = [item()];
    render(<OrgCaseList />);

    expect(
      screen.getByRole("option", { name: "Orchestrated flow" })
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Process flow" })).toBeNull();
  });

  it("hides the project filter and scopes the query when projectId is passed", () => {
    mocks.cases.data = [item()];
    render(<OrgCaseList projectId="p1" />);

    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(mocks.useOrgCases).toHaveBeenLastCalledWith({
      projectId: "p1",
      workflowId: undefined,
      status: undefined,
    });
  });

  it("shows the loading state", () => {
    mocks.cases.isLoading = true;
    render(<OrgCaseList />);

    expect(screen.getByRole("status", { name: "Loading cases" })).toBeTruthy();
  });

  it("shows the empty state", () => {
    mocks.cases.data = [];
    render(<OrgCaseList />);

    expect(screen.getByText("No cases match.")).toBeTruthy();
  });

  it("shows the error with a retry", async () => {
    mocks.cases.error = new Error("boom");
    render(<OrgCaseList />);

    await userEvent.click(screen.getByRole("button", { name: RETRY_RE }));

    expect(mocks.cases.refetch).toHaveBeenCalled();
  });
});
