import type { Workflow } from "@repo/api/src/types/workflow";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../../integrations/__tests__/integration-fixtures";
import { makeWorkflow, WORKFLOW_ID } from "../../__tests__/workflow-fixtures";
import { WORKFLOW_SOURCE_SYSTEMS_NOTICE } from "../../lib/workflow-labels";
import { WorkflowsIndexView } from "../workflows-index-view";

const mocks = vi.hoisted(() => ({
  workflows: {
    data: undefined as Workflow[] | undefined,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  setEnabledMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock("../../hooks/use-workflows", async () => {
  const actual = await vi.importActual("../../hooks/use-workflows");
  return {
    ...actual,
    useWorkflows: () => mocks.workflows,
    useSetWorkflowEnabled: () => ({
      mutate: mocks.setEnabledMutate,
      isPending: false,
      error: null,
    }),
    useUpdateWorkflow: () => ({
      mutate: mocks.updateMutate,
      isPending: false,
    }),
  };
});

vi.mock("@repo/app/integrations/hooks/use-integrations", () => ({
  useIntegrationProviders: () => ({ data: PROVIDERS }),
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflows.data = [makeWorkflow()];
  mocks.workflows.isLoading = false;
  mocks.workflows.error = null;
});

describe("WorkflowsIndexView", () => {
  it("lists workflows with triggers, project, run counts and a link", () => {
    render(<WorkflowsIndexView isAdmin />);

    expect(
      screen.getByRole("link", { name: "Implement Jira requirements" })
    ).toHaveAttribute("href", `/acme/workflows/${WORKFLOW_ID}`);
    expect(screen.getByText("Issue assigned to the bot")).toBeInTheDocument();
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("1 active")).toBeInTheDocument();
    expect(screen.getByText("2 succeeded")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(
      screen.getByText(WORKFLOW_SOURCE_SYSTEMS_NOTICE)
    ).toBeInTheDocument();
  });

  it("shows case counts for an orchestrated workflow", () => {
    mocks.workflows.data = [
      makeWorkflow({
        caseCounts: {
          total: 3,
          open: 1,
          closed: 2,
          lastActivityAt: null,
          needsPerson: 0,
        },
      }),
    ];
    render(<WorkflowsIndexView isAdmin />);

    expect(screen.getByText("3 cases")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  it("lets admins disable a workflow by flipping only its enabled flag", async () => {
    const user = userEvent.setup();
    render(<WorkflowsIndexView isAdmin />);

    await user.click(
      screen.getByRole("switch", {
        name: "Disable Implement Jira requirements",
      })
    );
    expect(mocks.setEnabledMutate).toHaveBeenCalledWith({
      id: WORKFLOW_ID,
      input: { enabled: false },
    });
    expect(mocks.updateMutate).not.toHaveBeenCalled();
  });

  it("can still turn off a workflow whose project is gone, but not turn it on", async () => {
    const user = userEvent.setup();
    mocks.workflows.data = [
      makeWorkflow({ project: null }),
      makeWorkflow({
        id: "66666666-6666-4666-8666-666666666666",
        name: "Paused workflow",
        enabled: false,
        project: null,
      }),
    ];
    render(<WorkflowsIndexView isAdmin />);

    expect(
      screen.getByRole("switch", { name: "Enable Paused workflow" })
    ).toBeDisabled();
    await user.click(
      screen.getByRole("switch", {
        name: "Disable Implement Jira requirements",
      })
    );
    expect(mocks.setEnabledMutate).toHaveBeenCalledWith({
      id: WORKFLOW_ID,
      input: { enabled: false },
    });
  });

  it("shows members a read-only list without the create action", () => {
    render(<WorkflowsIndexView isAdmin={false} />);

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "New workflow" })
    ).not.toBeInTheDocument();
  });

  it("shows the empty state and the error state", () => {
    mocks.workflows.data = [];
    const { unmount } = render(<WorkflowsIndexView isAdmin />);
    expect(screen.getByText("No workflows yet")).toBeInTheDocument();
    unmount();

    mocks.workflows.data = undefined;
    mocks.workflows.error = new Error("down");
    render(<WorkflowsIndexView isAdmin />);
    expect(screen.getByText("Couldn't load workflows")).toBeInTheDocument();
  });

  it("has no tabs and no create action of its own", () => {
    render(<WorkflowsIndexView isAdmin />);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Runs" })).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
