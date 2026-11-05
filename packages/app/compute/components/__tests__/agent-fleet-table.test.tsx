import {
  type AgentFleetEntry,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentFleetTable } from "../agent-fleet-table";

const mocks = vi.hoisted(() => ({
  fleet: {} as {
    data?: { agents: unknown[] };
    isLoading: boolean;
    error: Error | null;
    refetch: () => unknown;
  },
}));

vi.mock("@repo/app/compute/hooks/use-agent-fleet", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@repo/app/compute/hooks/use-agent-fleet")
  >()),
  useAgentFleet: () => mocks.fleet,
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

const SEEN = "2026-10-30T00:00:00.000Z";

function agent(overrides: Partial<AgentFleetEntry>): AgentFleetEntry {
  return {
    id: "a1",
    machineName: "machine",
    displayName: null,
    kind: AgentKind.Automatic,
    ownerName: null,
    isSharedWithOrg: false,
    isOnline: true,
    lastSeen: SEEN,
    health: null,
    claudeCode: {
      reported: null,
      pinned: "latest",
      status: ClaudeCodeVersionStatus.Unknown,
    },
    projects: [],
    enabledWorkflowCount: 0,
    ...overrides,
  };
}

function loaded(agents: AgentFleetEntry[]) {
  mocks.fleet = {
    data: { agents },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

describe("AgentFleetTable", () => {
  beforeEach(() => {
    mocks.fleet = { isLoading: false, error: null, refetch: vi.fn() };
  });

  it("renders kind, status, health and version cells per agent", () => {
    loaded([
      agent({
        id: "p1",
        machineName: "alice-laptop",
        displayName: "Alice's laptop",
        kind: AgentKind.Personal,
        ownerName: "Alice Nguyen",
        isOnline: true,
        health: {
          healthChecked: SEEN,
          allRequiredPassed: false,
          requiredFailureCount: 2,
        },
        claudeCode: {
          reported: "2.0.1",
          pinned: "2.1.296",
          status: ClaudeCodeVersionStatus.Mismatch,
        },
        projects: [
          {
            id: "pr1",
            name: "LeaveDesk",
            commands: ["/dev", "/review"],
            problemCount: 1,
          },
        ],
        enabledWorkflowCount: 3,
      }),
      agent({
        id: "auto1",
        machineName: "runner-1",
        isSharedWithOrg: true,
        health: {
          healthChecked: SEEN,
          allRequiredPassed: true,
          requiredFailureCount: 0,
        },
        claudeCode: {
          reported: "2.1.296",
          pinned: "2.1.296",
          status: ClaudeCodeVersionStatus.Match,
        },
      }),
      agent({ id: "off1", machineName: "old-box", isOnline: false }),
    ]);
    render(<AgentFleetTable />);

    const personal = screen.getByRole("link", { name: "Alice's laptop" });
    expect(personal).toHaveAttribute("href", "/acme/agents/p1");
    expect(screen.getByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByText("alice-laptop")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
    expect(screen.getByText("shared")).toBeInTheDocument();
    expect(screen.getByText("2 required checks failing")).toBeInTheDocument();
    expect(screen.getByText("pinned 2.1.296")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(
      screen.getAllByText("Automatic", { selector: "[data-slot=badge]" })
    ).toHaveLength(2);
    expect(
      screen.getByText("Offline · last seen", { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText("1 problems")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "LeaveDesk" })).toHaveAttribute(
      "href",
      "/acme/projects/pr1?tab=agents"
    );
  });

  it("shows summary counts", () => {
    loaded([
      agent({
        id: "1",
        kind: AgentKind.Personal,
        claudeCode: {
          reported: "1",
          pinned: "2",
          status: ClaudeCodeVersionStatus.Mismatch,
        },
      }),
      agent({ id: "2" }),
      agent({ id: "3", isOnline: false }),
    ]);
    render(<AgentFleetTable />);

    const summary = within(screen.getByTestId("agent-fleet-summary"));
    expect(summary.getByText("2 online")).toBeInTheDocument();
    expect(summary.getByText("1 offline")).toBeInTheDocument();
    expect(summary.getByText("2 automatic")).toBeInTheDocument();
    expect(summary.getByText("1 personal")).toBeInTheDocument();
    expect(summary.getByText("1 version mismatches")).toBeInTheDocument();
  });

  it("shows the empty state with a link to API keys", () => {
    loaded([]);
    render(<AgentFleetTable />);

    expect(
      screen.getByText("No agents yet.", { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/acme/settings?tab=api-keys"
    );
  });

  it("shows the error with a retry", () => {
    const refetch = vi.fn();
    mocks.fleet = { isLoading: false, error: new Error("down"), refetch };
    render(<AgentFleetTable />);

    expect(screen.getByText("Couldn't load agents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a loading status", () => {
    mocks.fleet = { isLoading: true, error: null, refetch: vi.fn() };
    render(<AgentFleetTable />);

    expect(
      screen.getByRole("status", { name: "Loading agents" })
    ).toBeInTheDocument();
  });
});
