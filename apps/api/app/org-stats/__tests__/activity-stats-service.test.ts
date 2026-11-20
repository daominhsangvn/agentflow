import { ORG_ACTIVITY_DAYS } from "@repo/api/src/types/org-stats";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orgActivityStatsService } from "@/app/org-stats/activity-stats-service";

const ORG = "org-1";
const NOW = new Date("2026-10-30T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  turnFindMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: {
    sql: (...parts: unknown[]) => parts,
    join: (parts: unknown[]) => parts,
  },
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      $queryRaw: mocks.queryRaw,
      orchestratorTurn: { findMany: mocks.turnFindMany },
    }),
}));

vi.mock("@/lib/usage/usage-windows", () => ({
  usageUnitsSql: vi.fn(() => []),
}));

// $queryRaw call order inside the service: usage, sessions, runs, opened, closed.
function mockRaw(rows: {
  usage?: unknown[];
  sessions?: unknown[];
  runs?: unknown[];
  opened?: unknown[];
  closed?: unknown[];
}) {
  mocks.queryRaw
    .mockResolvedValueOnce(rows.usage ?? [])
    .mockResolvedValueOnce(rows.sessions ?? [])
    .mockResolvedValueOnce(rows.runs ?? [])
    .mockResolvedValueOnce(rows.opened ?? [])
    .mockResolvedValueOnce(rows.closed ?? []);
}

describe("orgActivityStatsService.get", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.turnFindMany.mockResolvedValue([]);
  });

  it("zero-fills 30 UTC days, oldest first, ending today", async () => {
    mockRaw({});

    const { days } = await orgActivityStatsService.get(ORG, NOW);

    expect(days).toHaveLength(ORG_ACTIVITY_DAYS);
    expect(days[0]?.day).toBe("2026-10-01");
    expect(days.at(-1)?.day).toBe("2026-10-30");
    const keys = days.map((d) => d.day);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(days[3]).toMatchObject({
      sessions: 0,
      inputTokens: 0,
      costUsd: 0,
      runsSucceeded: 0,
      casesOpened: 0,
    });
  });

  it("uses null cost for a day with unpriced usage and 0 for a day without usage", async () => {
    mockRaw({
      usage: [
        {
          day: "2026-10-29",
          input_tokens: 10,
          output_tokens: 5,
          cost_usd: null,
          cost_known: 0,
          units: 2,
        },
        {
          day: "2026-10-28",
          input_tokens: 1,
          output_tokens: 1,
          cost_usd: "1.5",
          cost_known: 1,
          units: 1,
        },
      ],
    });

    const { days } = await orgActivityStatsService.get(ORG, NOW);
    const byDay = new Map(days.map((d) => [d.day, d]));

    expect(byDay.get("2026-10-29")?.costUsd).toBeNull();
    expect(byDay.get("2026-10-29")?.inputTokens).toBe(10);
    expect(byDay.get("2026-10-28")?.costUsd).toBe(1.5);
    expect(byDay.get("2026-10-27")?.costUsd).toBe(0);
  });

  it("puts turn usage, sessions, runs and cases on their UTC day", async () => {
    mockRaw({
      usage: [
        {
          day: new Date("2026-10-30T00:00:00.000Z"),
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: "2",
          cost_known: 1,
          units: 1,
        },
      ],
      sessions: [{ day: "2026-10-30", n: 3 }],
      runs: [
        { day: "2026-10-29", status: WorkflowRunStatus.Succeeded, n: 4 },
        { day: "2026-10-29", status: WorkflowRunStatus.Failed, n: 1 },
        { day: "2026-10-29", status: WorkflowRunStatus.Cancelled, n: 2 },
      ],
      opened: [{ day: "2026-10-15", n: 5 }],
      closed: [{ day: "2026-10-16", n: 6 }],
    });
    mocks.turnFindMany.mockResolvedValue([
      {
        usage: { inputTokens: 7, outputTokens: 3, costUsd: 0.5 },
        startedAt: new Date("2026-10-30T09:00:00.000Z"),
        finishedAt: new Date("2026-10-30T09:05:00.000Z"),
      },
    ]);

    const { days } = await orgActivityStatsService.get(ORG, NOW);
    const byDay = new Map(days.map((d) => [d.day, d]));

    expect(byDay.get("2026-10-30")).toMatchObject({
      sessions: 3,
      inputTokens: 107,
      outputTokens: 53,
      costUsd: 2.5,
    });
    expect(byDay.get("2026-10-29")).toMatchObject({
      runsSucceeded: 4,
      runsFailed: 1,
      runsCancelled: 2,
    });
    expect(byDay.get("2026-10-15")?.casesOpened).toBe(5);
    expect(byDay.get("2026-10-16")?.casesClosed).toBe(6);
  });
});
