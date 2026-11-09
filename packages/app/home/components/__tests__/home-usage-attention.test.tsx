import {
  OrgAttentionKind,
  type OrgAttentionStats,
  type OrgUsageStats,
} from "@repo/api/src/types/org-stats";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionWidget } from "../home-attention-widget";
import { UsageWidget } from "../home-usage-widget";

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
  usage: undefined as unknown,
  attention: undefined as unknown,
}));

vi.mock("../../hooks/use-org-stats", () => ({
  useOrgUsageStats: () => mocks.usage,
  useOrgAttentionStats: () => mocks.attention,
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const ZERO = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function usageStats(overrides: Partial<OrgUsageStats> = {}): OrgUsageStats {
  return {
    last7d: { inputTokens: 1000, outputTokens: 500, costUsd: null },
    last30d: ZERO,
    topCases: [{ id: "c1", name: "Case one", ...ZERO }],
    topWorkflows: [],
    topProjects: [],
    topAgents: [{ id: "a1", name: "runner-1", ...ZERO }],
    ...overrides,
  };
}

function attentionStats(
  overrides: Partial<OrgAttentionStats> = {}
): OrgAttentionStats {
  return {
    items: [],
    tasks7d: { succeeded: 0, failed: 0, blocked: 0 },
    failedRuns7d: 0,
    guardRefusals7d: 0,
    ...overrides,
  };
}

describe("UsageWidget", () => {
  beforeEach(() => {
    mocks.usage = ok(usageStats());
  });

  it("renders - for null cost and $0.00 for zero cost", () => {
    render(<UsageWidget />);
    const costs = screen.getAllByText("Cost");
    expect(costs).toHaveLength(2);
    const sevenDays = costs[0].previousElementSibling;
    const thirtyDays = costs[1].previousElementSibling;
    expect(sevenDays?.textContent).toBe("-");
    expect(thirtyDays?.textContent).toBe("$0.00");
  });

  it("links top cases to the case page and top agents to the agent page", () => {
    render(<UsageWidget />);
    expect(screen.getByRole("link", { name: "Case one" })).toHaveAttribute(
      "href",
      "/acme/orchestrator/cases/c1"
    );
    expect(screen.getByRole("link", { name: "runner-1" })).toHaveAttribute(
      "href",
      "/acme/agents/a1"
    );
    expect(
      within(screen.getByTestId("top-Workflows")).getByText("None yet")
    ).toBeInTheDocument();
  });
});

describe("AttentionWidget", () => {
  it("shows - success rate when there are no tasks", () => {
    mocks.attention = ok(attentionStats());
    render(<AttentionWidget />);
    const label = screen.getByText("Task success (7 days)");
    expect(label.previousElementSibling?.textContent).toBe("-");
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
  });

  it("computes the success rate", () => {
    mocks.attention = ok(
      attentionStats({ tasks7d: { succeeded: 3, failed: 1, blocked: 0 } })
    );
    render(<AttentionWidget />);
    expect(
      screen.getByText("Task success (7 days)").previousElementSibling
        ?.textContent
    ).toBe("75%");
  });

  it("links case items to the case and offline agents to the agent", () => {
    mocks.attention = ok(
      attentionStats({
        items: [
          {
            kind: OrgAttentionKind.WaitingForHuman,
            title: "Case title",
            detail: null,
            caseId: "c1",
            computeTargetId: null,
            projectName: "P",
            workflowName: "W",
            since: "2026-10-29T00:00:00.000Z",
          },
          {
            kind: OrgAttentionKind.OfflineAgent,
            title: "runner-9",
            detail: null,
            caseId: null,
            computeTargetId: "t9",
            projectName: null,
            workflowName: null,
            since: "2026-10-29T00:00:00.000Z",
          },
        ],
      })
    );
    render(<AttentionWidget />);
    expect(screen.getByRole("link", { name: "Case title" })).toHaveAttribute(
      "href",
      "/acme/orchestrator/cases/c1"
    );
    expect(screen.getByRole("link", { name: "runner-9" })).toHaveAttribute(
      "href",
      "/acme/agents/t9"
    );
    expect(screen.getByText("P · W")).toBeInTheDocument();
  });
});
