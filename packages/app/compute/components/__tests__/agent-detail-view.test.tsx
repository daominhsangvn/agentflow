import {
  type AgentDetail,
  AgentKind,
  AgentWorkflowRole,
  AgentWorkKind,
  AgentWorkStatus,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import {
  RunnerCapabilitiesSource,
  RunnerCommandMode,
} from "@repo/api/src/types/runner-capabilities";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { ApiError } from "@repo/app/shared/api/api-error";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDetailView } from "../agent-detail-view";

const mocks = vi.hoisted(() => ({
  query: {} as {
    data?: unknown;
    isLoading: boolean;
    error: Error | null;
    refetch: () => unknown;
  },
}));

vi.mock("@repo/app/compute/hooks/use-agent-fleet", () => ({
  useAgentDetail: () => mocks.query,
}));

vi.mock("@repo/app/shared/components/client-redirect", () => ({
  ClientRedirect: ({ href }: { href: string }) => (
    <div data-href={href} data-testid="redirect" />
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

const ISO = "2026-10-30T00:00:00.000Z";
const NO_USAGE = {
  tasks: 0,
  succeeded: 0,
  failed: 0,
  blocked: 0,
  activeMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

function fixture(): AgentDetail {
  return {
    agent: {
      id: "a1",
      machineName: "alice-laptop",
      displayName: "Alice's laptop",
      kind: AgentKind.Personal,
      ownerName: "Alice Nguyen",
      isSharedWithOrg: true,
      isOnline: true,
      lastSeen: ISO,
      health: {
        healthChecked: ISO,
        allRequiredPassed: false,
        requiredFailureCount: 1,
      },
      claudeCode: {
        reported: "2.0.1",
        pinned: "2.1.296",
        status: ClaudeCodeVersionStatus.Mismatch,
      },
      projects: [],
      enabledWorkflowCount: 1,
    },
    healthTools: [
      {
        id: "git",
        label: "git",
        required: true,
        passed: true,
        version: "2.45",
      },
      { id: "gh", label: "gh", required: true, passed: false, version: null },
    ],
    capabilities: [
      {
        projectId: "p1",
        projectName: "LeaveDesk",
        source: RunnerCapabilitiesSource.Toolkit,
        roleName: "Dev",
        commands: [
          {
            name: "/dev",
            description: "Implements a ticket",
            mode: RunnerCommandMode.Write,
            needs: ["approved-plan"],
            produces: "code",
            push: true,
          },
          { name: "/review", mode: RunnerCommandMode.Read },
        ],
        problems: [],
        warnings: ["Command /qa is declared but not found"],
        uploaded: ISO,
      },
    ],
    projects: [{ id: "p1", name: "LeaveDesk" }],
    workflows: [
      {
        id: "w1",
        name: "Delivery",
        projectId: "p1",
        projectName: "LeaveDesk",
        mode: WorkflowAgentMode.Orchestrated,
        roles: [AgentWorkflowRole.Orchestrator],
      },
    ],
    recentWork: [
      {
        id: "t1",
        kind: AgentWorkKind.Task,
        command: "/dev",
        status: AgentWorkStatus.Succeeded,
        caseId: "c1",
        caseTitle: "Leave balance",
        runId: null,
        workflowId: null,
        label: "PRO-12",
        started: ISO,
        finished: ISO,
        activeMs: 5_400_000,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: null,
      },
      {
        id: "l1",
        kind: AgentWorkKind.RunLoop,
        command: "/review",
        status: AgentWorkStatus.Failed,
        caseId: null,
        caseTitle: null,
        runId: "r1",
        workflowId: "w2",
        label: "Nightly review",
        started: ISO,
        finished: null,
        activeMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.5,
      },
    ],
    usage: {
      last7d: { ...NO_USAGE, tasks: 4, succeeded: 3, failed: 1 },
      last30d: { ...NO_USAGE, costUsd: null },
    },
  };
}

function loaded(data: AgentDetail) {
  mocks.query = { data, isLoading: false, error: null, refetch: vi.fn() };
}

describe("AgentDetailView", () => {
  beforeEach(() => {
    mocks.query = { isLoading: false, error: null, refetch: vi.fn() };
  });

  it("renders the header, capabilities, used by, tasks and usage", () => {
    loaded(fixture());
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    const header = within(screen.getByTestId("agent-header"));
    expect(header.getByText("Alice's laptop")).toBeInTheDocument();
    expect(header.getByText("Personal")).toBeInTheDocument();
    expect(header.getByText("Owner: Alice Nguyen")).toBeInTheDocument();
    expect(header.getByText("Version mismatch")).toBeInTheDocument();
    expect(
      header.getByText("Claude Code: 2.0.1 reported · 2.1.296 pinned")
    ).toBeInTheDocument();
    expect(header.getByText("Checked", { exact: false })).toHaveTextContent(
      "1 tools found, 1 missing"
    );
    expect(
      within(screen.getByTestId("health-missing")).getByText("gh (required)")
    ).toBeInTheDocument();

    const file = within(screen.getByTestId("capability-file"));
    expect(file.getByText("LeaveDesk · Dev")).toBeInTheDocument();
    expect(file.getByText("write")).toBeInTheDocument();
    expect(file.getByText("read")).toBeInTheDocument();
    expect(file.getByText("needs approved-plan")).toBeInTheDocument();
    expect(file.getByText("produces code")).toBeInTheDocument();
    expect(file.getByText("pushes")).toBeInTheDocument();
    expect(
      file.getByText("Command /qa is declared but not found")
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Delivery" })).toHaveAttribute(
      "href",
      "/acme/workflows/w1"
    );
    expect(screen.getByText("Orchestrator")).toBeInTheDocument();
  });

  it("links recent tasks to the case or the run, and shows unknown cost as -", () => {
    loaded(fixture());
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    expect(screen.getByRole("link", { name: "Leave balance" })).toHaveAttribute(
      "href",
      "/acme/orchestrator/cases/c1"
    );
    expect(
      screen.getByRole("link", { name: "Nightly review" })
    ).toHaveAttribute("href", "/acme/workflows/w2/runs/r1");
    const rows = screen.getAllByRole("row");
    // Header row, then the case task (cost unknown) and the run loop ($0.50).
    expect(within(rows[1]).getAllByText("-").length).toBeGreaterThan(0);
    expect(within(rows[1]).getByText("1h 30m")).toBeInTheDocument();
    expect(within(rows[2]).getByText("$0.50")).toBeInTheDocument();
  });

  it("computes the success rate and shows - when there are no tasks", () => {
    loaded(fixture());
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    expect(
      within(screen.getByTestId("usage-7-days")).getByText("75%")
    ).toBeInTheDocument();
    const thirty = within(screen.getByTestId("usage-30-days"));
    expect(
      thirty.getByText("Success rate").nextElementSibling
    ).toHaveTextContent("-");
    expect(thirty.getByText("Cost").nextElementSibling).toHaveTextContent("-");
  });

  it("shows empty states and Not checked yet", () => {
    loaded({
      ...fixture(),
      agent: { ...fixture().agent, health: null },
      capabilities: [],
      projects: [],
      workflows: [],
      recentWork: [],
    });
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    expect(
      screen.getByText("This agent has not uploaded an AGENTFLOW.md yet.")
    ).toBeInTheDocument();
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
  });

  it("redirects to the catalog on 404", () => {
    mocks.query = {
      isLoading: false,
      error: new ApiError("Agent not found", 404),
      refetch: vi.fn(),
    };
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    expect(screen.getByTestId("redirect")).toHaveAttribute(
      "data-href",
      "/acme/skills/a1"
    );
  });

  it("shows other errors with a retry", () => {
    const refetch = vi.fn();
    mocks.query = { isLoading: false, error: new Error("boom"), refetch };
    render(<AgentDetailView agentId="a1" notFoundHref="/acme/skills/a1" />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("redirect")).toBeNull();
  });
});
