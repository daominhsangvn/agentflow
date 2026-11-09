import { ProjectStatus } from "@repo/api/src/types/project";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { overviewStatsService } from "@/app/org-stats/overview-stats-service";

const mocks = vi.hoisted(() => ({
  projectCount: vi.fn(),
  projectFindMany: vi.fn(),
  caseFindMany: vi.fn(),
  runFindMany: vi.fn(),
  workflowCount: vi.fn(),
  sessionCount: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      project: { count: mocks.projectCount, findMany: mocks.projectFindMany },
      orchestratorCase: { findMany: mocks.caseFindMany },
      workflowRun: { findMany: mocks.runFindMany },
      workflow: { count: mocks.workflowCount },
      sessionDetail: { count: mocks.sessionCount },
    }),
}));

const NOW = new Date("2026-10-30T12:00:00.000Z");
const DAY_MS = 86_400_000;

describe("overviewStatsService.projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectCount.mockResolvedValue(4);
    mocks.caseFindMany.mockResolvedValue([{ projectId: "p1" }]);
    mocks.runFindMany.mockResolvedValue([
      { projectId: "p1" },
      { projectId: "p2" },
      { projectId: "p3" },
    ]);
    mocks.projectFindMany.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  });

  it("dedupes active projects across sources and drops archived ones", async () => {
    const stats = await overviewStatsService.projects("org", NOW);

    expect(stats).toEqual({ total: 4, active7d: 2 });
    expect(mocks.projectFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: "org",
      id: { in: ["p1", "p2", "p3"] },
      status: { not: ProjectStatus.Archived },
    });
  });

  it("uses a 7 day window and the organization on every query", async () => {
    await overviewStatsService.projects("org", NOW);

    const since = new Date(NOW.getTime() - 7 * DAY_MS);
    expect(mocks.caseFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: "org",
      updatedAt: { gte: since },
    });
    expect(mocks.runFindMany.mock.calls[0]?.[0].where).toEqual({
      organizationId: "org",
      createdAt: { gte: since },
    });
    expect(mocks.projectCount.mock.calls[0]?.[0].where.organizationId).toBe(
      "org"
    );
  });

  it("skips the lookup when nothing was active", async () => {
    mocks.caseFindMany.mockResolvedValue([]);
    mocks.runFindMany.mockResolvedValue([]);

    const stats = await overviewStatsService.projects("org", NOW);

    expect(stats.active7d).toBe(0);
    expect(mocks.projectFindMany).not.toHaveBeenCalled();
  });
});

describe("overviewStatsService.workflows", () => {
  it("derives process and disabled from the counts", async () => {
    mocks.workflowCount
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(7);

    const stats = await overviewStatsService.workflows("org");

    expect(stats).toEqual({
      total: 10,
      orchestrated: 3,
      process: 7,
      enabled: 7,
      disabled: 3,
    });
    expect(mocks.workflowCount.mock.calls[1]?.[0].where).toEqual({
      organizationId: "org",
      agentConfig: { path: ["mode"], equals: WorkflowAgentMode.Orchestrated },
    });
  });
});

describe("overviewStatsService.sessions", () => {
  it("counts 7 and 30 day windows for the organization", async () => {
    mocks.sessionCount.mockResolvedValueOnce(2).mockResolvedValueOnce(9);

    const stats = await overviewStatsService.sessions("org", NOW);

    expect(stats).toEqual({ last7d: 2, last30d: 9 });
    expect(mocks.sessionCount.mock.calls[0]?.[0].where).toEqual({
      artifact: { is: { organizationId: "org" } },
      sessionStartedAt: { gte: new Date(NOW.getTime() - 7 * DAY_MS) },
    });
    expect(
      mocks.sessionCount.mock.calls[1]?.[0].where.sessionStartedAt
    ).toEqual({ gte: new Date(NOW.getTime() - 30 * DAY_MS) });
  });
});
