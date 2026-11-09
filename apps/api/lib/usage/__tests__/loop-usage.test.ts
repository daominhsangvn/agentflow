import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoopUsageRow, SessionUsageRow } from "@/lib/usage/loop-usage";
import {
  addCost,
  loadLoopUsage,
  resolveLoopUsage,
  sessionActiveMs,
  turnUsage,
} from "@/lib/usage/loop-usage";

const mocks = vi.hoisted(() => ({
  loopFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      loop: { findMany: mocks.loopFindMany },
      sessionDetail: { findMany: mocks.sessionFindMany },
    }),
}));

const NOW = new Date("2026-10-30T12:00:00.000Z");
const MIN = 60_000;
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN);

function session(overrides: Partial<SessionUsageRow> = {}): SessionUsageRow {
  return {
    artifactId: "s1",
    sourceLoopId: "l1",
    inputTokens: BigInt(100),
    outputTokens: BigInt(40),
    estimatedCost: "0.5",
    sessionStartedAt: at(60),
    sessionEndedAt: at(0),
    lastActivityAt: null,
    sessionUpdatedAt: at(0),
    usageRollup: null,
    ...overrides,
  };
}

function loop(overrides: Partial<LoopUsageRow> = {}): LoopUsageRow {
  return {
    id: "l1",
    sessionArtifactId: null,
    tokensInput: 7,
    tokensOutput: 3,
    estimatedCost: "9",
    startedAt: at(20),
    completedAt: at(10),
    ...overrides,
  };
}

describe("sessionActiveMs", () => {
  it("prefers the rollup runtime", () => {
    const row = session({ usageRollup: { runtimeMs: BigInt(5000) } });

    expect(sessionActiveMs(row, NOW)).toBe(5000);
  });

  it("falls back to ended, last activity, then updated", () => {
    expect(sessionActiveMs(session(), NOW)).toBe(60 * MIN);
    expect(
      sessionActiveMs(
        session({ sessionEndedAt: null, lastActivityAt: at(30) }),
        NOW
      )
    ).toBe(30 * MIN);
    expect(
      sessionActiveMs(
        session({
          sessionEndedAt: null,
          lastActivityAt: null,
          sessionUpdatedAt: at(45),
        }),
        NOW
      )
    ).toBe(15 * MIN);
  });

  it("ignores a zero runtime and clamps negatives", () => {
    const zero = session({ usageRollup: { runtimeMs: BigInt(0) } });
    const negative = session({ sessionEndedAt: at(90) });

    expect(sessionActiveMs(zero, NOW)).toBe(60 * MIN);
    expect(sessionActiveMs(negative, NOW)).toBe(0);
  });
});

describe("resolveLoopUsage", () => {
  it("uses the session and ignores the loop numbers", () => {
    const usage = resolveLoopUsage(loop(), [session()], NOW);

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      costUsd: 0.5,
      activeMs: 60 * MIN,
    });
  });

  it("sums two sessions of one loop", () => {
    const usage = resolveLoopUsage(
      loop(),
      [session(), session({ artifactId: "s2", estimatedCost: "0.25" })],
      NOW
    );

    expect(usage.costUsd).toBeCloseTo(0.75);
    expect(usage.inputTokens).toBe(200);
  });

  it("matches a session by the loop's session artifact", () => {
    const usage = resolveLoopUsage(
      loop({ sessionArtifactId: "s9" }),
      [session({ artifactId: "s9", sourceLoopId: null })],
      NOW
    );

    expect(usage.inputTokens).toBe(100);
  });

  it("ignores sessions of other loops", () => {
    const usage = resolveLoopUsage(
      loop(),
      [session({ sourceLoopId: "other" })],
      NOW
    );

    expect(usage.inputTokens).toBe(7);
  });

  it("uses the loop numbers and span when there is no session", () => {
    expect(resolveLoopUsage(loop(), [], NOW)).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      costUsd: 9,
      activeMs: 10 * MIN,
    });
  });

  it("measures a running loop to now and keeps a null cost", () => {
    const usage = resolveLoopUsage(
      loop({ completedAt: null, estimatedCost: null }),
      [],
      NOW
    );

    expect(usage.activeMs).toBe(20 * MIN);
    expect(usage.costUsd).toBeNull();
  });

  it("adds no time for a loop that has not started", () => {
    expect(resolveLoopUsage(loop({ startedAt: null }), [], NOW).activeMs).toBe(
      0
    );
  });
});

describe("turnUsage", () => {
  it("reads tokens and cost and measures to now while running", () => {
    const usage = turnUsage(
      {
        usage: { costUsd: 0.1, inputTokens: 5, outputTokens: 2 },
        startedAt: at(5),
        finishedAt: null,
      },
      NOW
    );

    expect(usage).toEqual({
      inputTokens: 5,
      outputTokens: 2,
      costUsd: 0.1,
      activeMs: 5 * MIN,
    });
  });

  it("keeps cost null for a turn without usage", () => {
    const usage = turnUsage(
      { usage: { timeoutMs: 1 }, startedAt: at(1), finishedAt: at(0) },
      NOW
    );

    expect(usage.costUsd).toBeNull();
    expect(usage.inputTokens).toBe(0);
  });
});

describe("addCost", () => {
  it("keeps unknown unknown and a known zero known", () => {
    expect(addCost(null, null)).toBeNull();
    expect(addCost(null, 0)).toBe(0);
    expect(addCost(1, null)).toBe(1);
    expect(addCost(1, 2)).toBe(3);
  });
});

describe("loadLoopUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loopFindMany.mockResolvedValue([]);
    mocks.sessionFindMany.mockResolvedValue([]);
  });

  it("makes no query without loops", async () => {
    const result = await loadLoopUsage("org", [], NOW);

    expect(result.size).toBe(0);
    expect(mocks.loopFindMany).not.toHaveBeenCalled();
  });

  it("scopes sessions to the organization and folds per loop", async () => {
    mocks.loopFindMany.mockResolvedValue([loop({ sessionArtifactId: "s1" })]);
    mocks.sessionFindMany.mockResolvedValue([session()]);

    const result = await loadLoopUsage("org", ["l1"], NOW);

    expect(mocks.sessionFindMany.mock.calls[0]?.[0].where).toEqual({
      artifact: { is: { organizationId: "org" } },
      OR: [{ sourceLoopId: { in: ["l1"] } }, { artifactId: { in: ["s1"] } }],
    });
    expect(result.get("l1")?.inputTokens).toBe(100);
  });

  it("drops the artifact arm without session artifacts", async () => {
    mocks.loopFindMany.mockResolvedValue([loop()]);

    await loadLoopUsage("org", ["l1"], NOW);

    expect(mocks.sessionFindMany.mock.calls[0]?.[0].where.OR).toEqual([
      { sourceLoopId: { in: ["l1"] } },
    ]);
  });
});
