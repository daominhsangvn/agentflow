import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { KPI_NO_VALUE } from "@repo/app/shared/lib/format-utils";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrgRunsView } from "../org-runs-view";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  summary: vi.fn(),
  summaryResult: {
    data: undefined as unknown,
    isError: false,
    isLoading: false,
  },
}));

vi.mock("../workflow-runs-table", () => ({
  OrgWorkflowRunHistory: (props: { filters: unknown }) => {
    mocks.history(props.filters);
    return <div data-testid="history" />;
  },
}));

vi.mock("@repo/app/projects/hooks/use-projects", () => ({
  useProjects: () => ({ data: [{ id: "p1", name: "Web" }] }),
}));

vi.mock("../../hooks/use-workflows", () => ({
  useOrgWorkflowRunsSummary: (filters: unknown) => {
    mocks.summary(filters);
    return mocks.summaryResult;
  },
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

describe("OrgRunsView", () => {
  beforeEach(() => {
    mocks.history.mockReset();
    mocks.summary.mockReset();
    mocks.summaryResult.data = {
      total: 10,
      active: 2,
      needsYou: 1,
      succeeded: 5,
      failed: 2,
      cancelled: 0,
    };
    mocks.summaryResult.isError = false;
    mocks.summaryResult.isLoading = false;
  });

  it("passes the project and status filters to the run history", async () => {
    render(<OrgRunsView />);
    const [project, , status] = screen.getAllByRole(
      "combobox"
    ) as HTMLElement[];

    await userEvent.selectOptions(project as HTMLElement, "p1");
    await userEvent.selectOptions(
      status as HTMLElement,
      WorkflowRunStatus.Failed
    );

    expect(mocks.history).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "p1",
        workflowId: undefined,
        status: WorkflowRunStatus.Failed,
      })
    );
    expect(mocks.summary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: "p1",
        status: WorkflowRunStatus.Failed,
      })
    );
  });

  it("hides the project filter and scopes the runs when projectId is passed", () => {
    render(<OrgRunsView projectId="p1" />);

    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    expect(mocks.history).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "p1", workflowId: undefined })
    );
  });

  it("offers only process-mode workflows", () => {
    render(<OrgRunsView />);

    expect(screen.getByRole("option", { name: "Process flow" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "Orchestrated flow" })
    ).toBeNull();
  });

  it("shows the stats from the summary", () => {
    render(<OrgRunsView layout="page" />);

    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getAllByText("Needs you").length).toBeTruthy();
    expect(screen.getAllByText("Succeeded").length).toBeGreaterThan(0);
  });

  it("dashes only the cards when the summary fails, and keeps the table", () => {
    mocks.summaryResult.data = undefined;
    mocks.summaryResult.isError = true;
    render(<OrgRunsView layout="page" />);

    expect(screen.queryByText("10")).toBeNull();
    expect(screen.getAllByText(KPI_NO_VALUE).length).toBeGreaterThan(0);
    expect(screen.getByTestId("history")).toBeTruthy();
  });

  it("sends the same date window to the list and the summary", async () => {
    render(<OrgRunsView />);
    await userEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));

    for (const mock of [mocks.history, mocks.summary]) {
      const filters = mock.mock.lastCall?.[0] as {
        startDate?: string;
        endDate?: string;
      };
      expect(filters.startDate).toBeTruthy();
      expect(filters.endDate).toBeTruthy();
    }
  });
});
