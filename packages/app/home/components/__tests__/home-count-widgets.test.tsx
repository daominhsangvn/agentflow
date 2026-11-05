import {
  type AgentFleetEntry,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import type { OrgCaseStats } from "@repo/api/src/types/org-stats";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentsWidget,
  CasesWidget,
  ProjectsWidget,
  SessionsWidget,
  WorkflowsWidget,
} from "../home-count-widgets";
import { StatValue } from "../home-stat-card";

type QueryState<T> = {
  data?: T;
  isLoading: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
};

function ok<T>(data: T): QueryState<T> {
  return { data, isLoading: false, error: null, refetch: vi.fn() };
}

const mocks = vi.hoisted(() => ({
  projects: undefined as unknown,
  workflows: undefined as unknown,
  cases: undefined as unknown,
  sessions: undefined as unknown,
  fleet: undefined as unknown,
}));

vi.mock("../../hooks/use-org-stats", () => ({
  useOrgProjectStats: () => mocks.projects,
  useOrgWorkflowStats: () => mocks.workflows,
  useOrgCaseStats: () => mocks.cases,
  useOrgSessionStats: () => mocks.sessions,
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
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const CASES: OrgCaseStats = {
  open: 4,
  waitingForHuman: 2,
  withBlockedOrFailedTasks: 1,
  closed7d: 6,
  closed30d: 21,
  time7d: {
    sampleSize: 6,
    medianActiveMs: 1_800_000,
    totalActiveMs: 5_400_000,
    medianElapsedMs: 86_400_000,
  },
  time30d: {
    sampleSize: 21,
    medianActiveMs: null,
    totalActiveMs: 61_200_000,
    medianElapsedMs: null,
  },
};

function fleetAgent(overrides: Partial<AgentFleetEntry>): AgentFleetEntry {
  return {
    id: "a1",
    machineName: "m1",
    displayName: null,
    kind: AgentKind.Automatic,
    ownerName: null,
    isSharedWithOrg: false,
    isOnline: true,
    lastSeen: "2026-10-30T00:00:00.000Z",
    health: null,
    claudeCode: {
      reported: "2.1.0",
      pinned: "2.1.0",
      status: ClaudeCodeVersionStatus.Match,
    },
    projects: [],
    enabledWorkflowCount: 0,
    ...overrides,
  };
}

describe("Home count widgets", () => {
  beforeEach(() => {
    mocks.projects = ok({ total: 8, active7d: 5 });
    mocks.workflows = ok({
      total: 6,
      orchestrated: 2,
      process: 4,
      enabled: 5,
      disabled: 1,
    });
    mocks.cases = ok(CASES);
    mocks.sessions = ok({ last7d: 42, last30d: 180 });
    mocks.fleet = ok({
      agents: [
        fleetAgent({ id: "a1" }),
        fleetAgent({
          id: "a2",
          isOnline: false,
          kind: AgentKind.Personal,
          claudeCode: {
            reported: "2.0.0",
            pinned: "2.1.0",
            status: ClaudeCodeVersionStatus.Mismatch,
          },
        }),
      ],
    });
  });

  it("renders the numbers of each widget", () => {
    render(
      <>
        <ProjectsWidget />
        <WorkflowsWidget />
        <SessionsWidget />
        <AgentsWidget />
      </>
    );

    const projects = screen.getByTestId("home-widget-projects");
    expect(within(projects).getByText("8")).toBeInTheDocument();
    expect(within(projects).getByText("5")).toBeInTheDocument();
    expect(
      within(projects).getByRole("link", { name: "View projects" })
    ).toHaveAttribute("href", "/acme/projects");

    const workflows = screen.getByTestId("home-widget-workflows");
    expect(within(workflows).getByText("Orchestrated")).toBeInTheDocument();
    expect(within(workflows).getByText("6")).toBeInTheDocument();

    const sessions = screen.getByTestId("home-widget-sessions");
    expect(within(sessions).getByText("42")).toBeInTheDocument();
    expect(within(sessions).getByText("180")).toBeInTheDocument();

    const agents = screen.getByTestId("home-widget-agents");
    expect(
      within(agents).getByText("Claude Code version mismatches")
    ).toBeInTheDocument();
    expect(
      within(agents).getByRole("link", { name: "View agents" })
    ).toHaveAttribute("href", "/acme/agents");
  });

  it("shows the cases numbers and switches the active time window", () => {
    render(<CasesWidget />);

    expect(screen.getByText("Waiting for a person")).toBeInTheDocument();
    // Default window is 30d: median unknown renders "-", total is 17h.
    expect(screen.getByText("17h 0m")).toBeInTheDocument();
    expect(
      screen.getByText("Based on 21 closed cases in the last 30 days")
    ).toBeInTheDocument();
    expect(screen.getByTestId("median-elapsed")).toHaveTextContent(
      "Median elapsed (opened → closed): -"
    );

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    expect(screen.getByText("30m")).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    expect(
      screen.getByText("Based on 6 closed cases in the last 7 days")
    ).toBeInTheDocument();
    expect(screen.getByTestId("median-elapsed")).toHaveTextContent("1d 0h");
  });

  it("renders the elapsed line smaller than the active time", () => {
    render(<CasesWidget />);

    expect(screen.getByTestId("median-elapsed")).toHaveClass("text-xs");
    expect(
      screen.getByText("Median active time").previousElementSibling
    ).toHaveClass("text-xl");
  });

  it("shows empty text for no cases and no agents", () => {
    mocks.cases = ok({
      ...CASES,
      open: 0,
      closed7d: 0,
      closed30d: 0,
    });
    mocks.fleet = ok({ agents: [] });
    render(
      <>
        <CasesWidget />
        <AgentsWidget />
      </>
    );

    expect(screen.getByText("No cases yet")).toBeInTheDocument();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("renders real zeros for known totals", () => {
    mocks.sessions = ok({ last7d: 0, last30d: 0 });
    render(<SessionsWidget />);

    expect(screen.getAllByText("0")).toHaveLength(2);
  });

  it("renders a loading status", () => {
    mocks.projects = {
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    };
    render(<ProjectsWidget />);

    expect(
      screen.getByRole("status", { name: "Loading Projects" })
    ).toBeInTheDocument();
  });

  it("keeps rendering another widget when one fails, and retries", () => {
    const refetch = vi.fn();
    mocks.projects = {
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
      refetch,
    };
    render(
      <>
        <ProjectsWidget />
        <SessionsWidget />
      </>
    );

    expect(screen.getByText("Couldn't load projects")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("StatValue", () => {
  it.each([
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("renders - for %s", (value) => {
    render(<StatValue label="Thing" value={value} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("formats a finite number", () => {
    render(<StatValue format={(v) => `${v}x`} label="Thing" value={3} />);
    expect(screen.getByText("3x")).toBeInTheDocument();
  });
});
