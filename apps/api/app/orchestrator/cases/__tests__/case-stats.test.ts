import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  foldCaseStats,
  loadCaseStats,
} from "@/app/orchestrator/cases/service/case-stats";
import type { UsageTotals } from "@/lib/usage/loop-usage";

const mocks = vi.hoisted(() => ({
  turnFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  loadLoopUsage: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorTurn: { findMany: mocks.turnFindMany },
      orchestratorTask: { findMany: mocks.taskFindMany },
    }),
}));

vi.mock("@/lib/usage/loop-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/usage/loop-usage")>()),
  loadLoopUsage: mocks.loadLoopUsage,
}));

const NOW = new Date("2026-10-30T12:00:00.000Z");
const MIN = 60_000;

const turn = (caseId: string, usage: unknown, durationMs = 0) => ({
  usage,
  startedAt: new Date(NOW.getTime() - durationMs),
  finishedAt: NOW,
  conversation: { caseId },
});

const loopUsage = (
  costUsd: number | null,
  activeMs: number,
  tokens = 0
): UsageTotals => ({
  inputTokens: tokens,
  outputTokens: tokens,
  costUsd,
  activeMs,
});

describe("foldCaseStats", () => {
  it("counts turns and tasks per case", () => {
    const stats = foldCaseStats(
      ["a", "b"],
      [turn("a", null), turn("a", null), turn("b", null)],
      [{ caseId: "a", loopId: null }],
      new Map(),
      NOW
    );

    expect(stats.get("a")).toMatchObject({ taskCount: 1, turnCount: 2 });
    expect(stats.get("b")).toMatchObject({ taskCount: 0, turnCount: 1 });
  });

  it("leaves cost null when nothing is known", () => {
    const stats = foldCaseStats(
      ["a"],
      [turn("a", { timeoutMs: 1000 })],
      [{ caseId: "a", loopId: "l1" }],
      new Map([["l1", loopUsage(null, 0)]]),
      NOW
    );

    expect(stats.get("a")?.costUsd).toBeNull();
  });

  it("sums turn and loop cost and keeps a known zero", () => {
    const summed = foldCaseStats(
      ["a"],
      [turn("a", { costUsd: 0.25 })],
      [{ caseId: "a", loopId: "l1" }],
      new Map([["l1", loopUsage(0.5, 0)]]),
      NOW
    );
    const zero = foldCaseStats(
      ["a"],
      [turn("a", { costUsd: 0 })],
      [],
      new Map(),
      NOW
    );

    expect(summed.get("a")?.costUsd).toBeCloseTo(0.75);
    expect(zero.get("a")?.costUsd).toBe(0);
  });

  it("adds a turn and two task sessions into active time and tokens", () => {
    const stats = foldCaseStats(
      ["a"],
      [turn("a", { inputTokens: 10, outputTokens: 5 }, 5 * MIN)],
      [
        { caseId: "a", loopId: "l1" },
        { caseId: "a", loopId: "l2" },
        { caseId: "a", loopId: null },
      ],
      new Map([
        ["l1", loopUsage(1, 60 * MIN, 100)],
        ["l2", loopUsage(0.5, 30 * MIN, 50)],
      ]),
      NOW
    );

    expect(stats.get("a")).toMatchObject({
      activeMs: 95 * MIN,
      inputTokens: 160,
      outputTokens: 155,
      taskCount: 3,
    });
    expect(stats.get("a")?.costUsd).toBeCloseTo(1.5);
  });
});

describe("loadCaseStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.turnFindMany.mockResolvedValue([]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.loadLoopUsage.mockResolvedValue(new Map());
  });

  it("makes no query without cases", async () => {
    const stats = await loadCaseStats("org", []);

    expect(stats.size).toBe(0);
    expect(mocks.turnFindMany).not.toHaveBeenCalled();
    expect(mocks.taskFindMany).not.toHaveBeenCalled();
  });

  it("loads loop usage once for the distinct loops", async () => {
    mocks.taskFindMany.mockResolvedValue([
      { caseId: "a", loopId: "l1" },
      { caseId: "a", loopId: "l1" },
      { caseId: "a", loopId: null },
    ]);
    mocks.loadLoopUsage.mockResolvedValue(new Map([["l1", loopUsage(1.5, 0)]]));

    const stats = await loadCaseStats("org", ["a"], NOW);

    expect(mocks.loadLoopUsage).toHaveBeenCalledTimes(1);
    expect(mocks.loadLoopUsage).toHaveBeenCalledWith("org", ["l1"], NOW);
    expect(stats.get("a")?.costUsd).toBe(3);
  });
});
