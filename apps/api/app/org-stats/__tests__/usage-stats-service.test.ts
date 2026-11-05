import { beforeEach, describe, expect, it, vi } from "vitest";
import { orgUsageStatsService } from "@/app/org-stats/usage-stats-service";

const ORG = "org-1";
const NOW = new Date("2026-10-30T12:00:00.000Z");
const DAY = 86_400_000;

const mocks = vi.hoisted(() => ({
  loadWindowedUsage: vi.fn(),
  loadLoopUsage: vi.fn(),
  loadCaseStats: vi.fn(),
  caseFindMany: vi.fn(),
  runFindMany: vi.fn(),
  workflowFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  targetFindMany: vi.fn(),
}));

vi.mock("@/lib/usage/usage-windows", () => ({
  loadWindowedUsage: mocks.loadWindowedUsage,
}));
vi.mock("@/lib/usage/loop-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage/loop-usage")>()),
  loadLoopUsage: mocks.loadLoopUsage,
}));
vi.mock("@/app/orchestrator/cases/service/case-stats", () => ({
  loadCaseStats: mocks.loadCaseStats,
}));
vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorCase: { findMany: mocks.caseFindMany },
      workflowRun: { findMany: mocks.runFindMany },
      workflow: { findMany: mocks.workflowFindMany },
      project: { findMany: mocks.projectFindMany },
      computeTarget: { findMany: mocks.targetFindMany },
    }),
}));

const usage = (costUsd: number | null, tokens: number) => ({
  inputTokens: tokens,
  outputTokens: tokens,
  costUsd,
  activeMs: 0,
});

describe("orgUsageStatsService.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWindowedUsage.mockResolvedValue({
      last7d: usage(1, 5),
      last30d: usage(4, 20),
      byAgent: new Map([["t1", usage(4, 20)]]),
    });
    mocks.caseFindMany.mockResolvedValue([
      { id: "c1", title: "Case one", workflowId: "w1", projectId: "p1" },
    ]);
    mocks.runFindMany.mockResolvedValue([
      {
        id: "r1",
        workflowId: "w1",
        projectId: "p1",
        loops: [{ loopId: "l1" }],
      },
    ]);
    mocks.loadCaseStats.mockResolvedValue(new Map([["c1", usage(2, 10)]]));
    mocks.loadLoopUsage.mockResolvedValue(new Map([["l1", usage(1, 5)]]));
    mocks.workflowFindMany.mockResolvedValue([{ id: "w1", name: "Flow" }]);
    mocks.projectFindMany.mockResolvedValue([{ id: "p1", name: "Project" }]);
    mocks.targetFindMany.mockResolvedValue([{ id: "t1", machineName: "r-1" }]);
  });

  it("sums a workflow's case and run together", async () => {
    const stats = await orgUsageStatsService.get(ORG, NOW);

    expect(stats.last7d).toEqual({
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 1,
    });
    expect(stats.topWorkflows).toEqual([
      { id: "w1", name: "Flow", inputTokens: 15, outputTokens: 15, costUsd: 3 },
    ]);
    expect(stats.topProjects[0]).toMatchObject({ id: "p1", costUsd: 3 });
    expect(stats.topCases[0]).toMatchObject({ id: "c1", name: "Case one" });
    expect(stats.topAgents[0]).toMatchObject({ id: "t1", name: "r-1" });
  });

  it("scopes to the organization and the 30 day window", async () => {
    await orgUsageStatsService.get(ORG, NOW);

    const since30 = new Date(NOW.getTime() - 30 * DAY);
    expect(mocks.caseFindMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, updatedAt: { gte: since30 } },
      take: 500,
    });
    expect(mocks.runFindMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, createdAt: { gte: since30 } },
      take: 1000,
    });
    expect(mocks.loadWindowedUsage).toHaveBeenCalledWith(ORG, { now: NOW });
    expect(mocks.loadLoopUsage).toHaveBeenCalledWith(ORG, ["l1"], NOW);
  });
});
