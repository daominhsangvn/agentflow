import { describe, expect, it, vi } from "vitest";
import type { UsageGroupRow } from "@/lib/usage/usage-windows";
import {
  foldWindowedUsage,
  loadWindowedUsage,
} from "@/lib/usage/usage-windows";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  turnFindMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray) => ({ strings }),
    empty: { empty: true },
  },
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      $queryRaw: mocks.queryRaw,
      orchestratorTurn: { findMany: mocks.turnFindMany },
    }),
}));

const NOW = new Date("2026-10-30T12:00:00.000Z");
const SINCE7 = new Date("2026-10-23T12:00:00.000Z");
const MIN = 60_000;

function group(overrides: Partial<UsageGroupRow> = {}): UsageGroupRow {
  return {
    compute_target_id: "t1",
    in7d: true,
    input_tokens: BigInt(10),
    output_tokens: BigInt(4),
    cost_usd: "1.5",
    cost_known: 1,
    active_ms: BigInt(MIN),
    ...overrides,
  };
}

describe("foldWindowedUsage", () => {
  it("splits 7d and 30d", () => {
    const result = foldWindowedUsage(
      [group(), group({ in7d: false })],
      [],
      SINCE7,
      NOW
    );

    expect(result.last7d.inputTokens).toBe(10);
    expect(result.last30d.inputTokens).toBe(20);
    expect(result.last30d.costUsd).toBe(3);
  });

  it("reports unknown cost when no cost is known", () => {
    const result = foldWindowedUsage(
      [group({ cost_usd: null, cost_known: 0 })],
      [],
      SINCE7,
      NOW
    );

    expect(result.last30d.costUsd).toBeNull();
  });

  it("counts a null target in totals but not by agent", () => {
    const result = foldWindowedUsage(
      [group({ compute_target_id: null })],
      [],
      SINCE7,
      NOW
    );

    expect(result.last30d.inputTokens).toBe(10);
    expect(result.byAgent.size).toBe(0);
  });

  it("adds turns to totals and to their agent", () => {
    const result = foldWindowedUsage(
      [group()],
      [
        {
          usage: { costUsd: 0.5, inputTokens: 1, outputTokens: 1 },
          startedAt: new Date(NOW.getTime() - 10 * MIN),
          finishedAt: NOW,
          computeTargetId: "t1",
        },
        {
          usage: { costUsd: 0.5, inputTokens: 1, outputTokens: 1 },
          startedAt: new Date("2026-10-10T12:00:00.000Z"),
          finishedAt: new Date("2026-10-10T12:05:00.000Z"),
          computeTargetId: "t1",
        },
      ],
      SINCE7,
      NOW
    );

    expect(result.last7d.costUsd).toBe(2);
    expect(result.last30d.costUsd).toBe(2.5);
    expect(result.byAgent.get("t1")?.activeMs).toBe(MIN + 10 * MIN + 5 * MIN);
  });
});

describe("loadWindowedUsage", () => {
  it("runs one raw query and one turn query", async () => {
    mocks.queryRaw.mockResolvedValue([group()]);
    mocks.turnFindMany.mockResolvedValue([]);

    const result = await loadWindowedUsage("org", { now: NOW });

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.turnFindMany.mock.calls[0]?.[0].where.organizationId).toBe(
      "org"
    );
    expect(result.last7d.inputTokens).toBe(10);
  });
});
