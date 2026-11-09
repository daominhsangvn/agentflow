import {
  ORCHESTRATOR_TASK_BLOCKED_PREFIX,
  OrchestratorCaseStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockedOrFailedTaskWhere,
  caseTimeStats,
  median,
  orgCaseStatsService,
} from "@/app/org-stats/case-stats-service";

const ORG = "org-1";
const NOW = new Date("2026-10-30T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  loadCaseStats: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ orchestratorCase: { count: mocks.count, findMany: mocks.findMany } }),
}));

vi.mock("@/app/orchestrator/cases/service/case-stats", () => ({
  loadCaseStats: mocks.loadCaseStats,
}));

describe("median", () => {
  it("is null for no values", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle of an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the middle two of an even count", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("ignores non-finite and negative values", () => {
    expect(median([Number.NaN, Number.POSITIVE_INFINITY, -4, 8])).toBe(8);
  });
});

describe("caseTimeStats", () => {
  it("reports active and elapsed time separately", () => {
    const createdAt = new Date(NOW.getTime() - DAY);
    const stats = caseTimeStats([
      { createdAt, closedAt: NOW, activeMs: 1.5 * HOUR },
    ]);

    expect(stats).toEqual({
      sampleSize: 1,
      medianActiveMs: 1.5 * HOUR,
      totalActiveMs: 1.5 * HOUR,
      medianElapsedMs: DAY,
    });
  });

  it("skips cases without a close time", () => {
    const stats = caseTimeStats([
      { createdAt: NOW, closedAt: null, activeMs: HOUR },
    ]);

    expect(stats).toEqual({
      sampleSize: 0,
      medianActiveMs: null,
      totalActiveMs: 0,
      medianElapsedMs: null,
    });
  });
});

describe("blockedOrFailedTaskWhere", () => {
  it("matches failed tasks and BLOCKED replies since the date", () => {
    const since = new Date(NOW.getTime() - 7 * DAY);

    expect(blockedOrFailedTaskWhere(since)).toEqual({
      finishedAt: { gte: since },
      OR: [
        { status: OrchestratorTaskStatus.Failed },
        {
          status: OrchestratorTaskStatus.Succeeded,
          result: {
            path: ["reply"],
            string_starts_with: ORCHESTRATOR_TASK_BLOCKED_PREFIX,
          },
        },
      ],
    });
  });
});

describe("orgCaseStatsService.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(3);
    mocks.findMany.mockResolvedValue([
      {
        id: "recent",
        createdAt: new Date(NOW.getTime() - DAY),
        closedAt: new Date(NOW.getTime() - DAY / 2),
      },
      {
        id: "older",
        createdAt: new Date(NOW.getTime() - 20 * DAY),
        closedAt: new Date(NOW.getTime() - 10 * DAY),
      },
    ]);
    mocks.loadCaseStats.mockResolvedValue(
      new Map([
        ["recent", { activeMs: HOUR }],
        ["older", { activeMs: 3 * HOUR }],
      ])
    );
  });

  it("scopes every query to the organization and the closed windows", async () => {
    await orgCaseStatsService.get(ORG, NOW);

    const since7 = new Date(NOW.getTime() - 7 * DAY);
    const since30 = new Date(NOW.getTime() - 30 * DAY);
    const wheres = mocks.count.mock.calls.map((call) => call[0].where);
    expect(wheres.every((where) => where.organizationId === ORG)).toBe(true);
    expect(wheres[0].status).toBe(OrchestratorCaseStatus.Open);
    expect(wheres[3]).toEqual({
      organizationId: ORG,
      status: OrchestratorCaseStatus.Closed,
      closedAt: { gte: since7 },
    });
    expect(wheres[4].closedAt).toEqual({ gte: since30 });
    expect(mocks.findMany.mock.calls[0][0].take).toBe(1000);
    expect(mocks.loadCaseStats).toHaveBeenCalledWith(
      ORG,
      ["recent", "older"],
      NOW
    );
  });

  it("splits the 7 day subset from the 30 day times", async () => {
    const stats = await orgCaseStatsService.get(ORG, NOW);

    expect(stats.time7d).toMatchObject({
      sampleSize: 1,
      medianActiveMs: HOUR,
      totalActiveMs: HOUR,
    });
    expect(stats.time30d).toMatchObject({
      sampleSize: 2,
      medianActiveMs: 2 * HOUR,
      totalActiveMs: 4 * HOUR,
    });
  });
});
