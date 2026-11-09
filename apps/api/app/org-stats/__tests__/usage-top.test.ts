import type { OrgUsageTotals } from "@repo/api/src/types/org-stats";
import { describe, expect, it } from "vitest";
import { sumByKey, topRows } from "@/app/org-stats/usage-top";

const totals = (costUsd: number | null, tokens = 0): OrgUsageTotals => ({
  inputTokens: tokens,
  outputTokens: 0,
  costUsd,
});

describe("topRows", () => {
  const names = new Map([
    ["a", "A"],
    ["b", "B"],
    ["c", "C"],
    ["d", "D"],
  ]);

  it("orders by cost, unknown cost last, ties by tokens", () => {
    const rows = topRows(
      new Map([
        ["a", totals(null, 999)],
        ["b", totals(1, 10)],
        ["c", totals(1, 50)],
        ["d", totals(5, 0)],
      ]),
      names
    );

    expect(rows.map((row) => row.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("caps the rows and drops ids without a name", () => {
    const rows = topRows(
      new Map([
        ["a", totals(3)],
        ["b", totals(2)],
        ["ghost", totals(100)],
      ]),
      names,
      1
    );

    expect(rows).toEqual([{ id: "a", name: "A", ...totals(3) }]);
  });
});

describe("sumByKey", () => {
  const usage = (costUsd: number | null, tokens: number) => ({
    inputTokens: tokens,
    outputTokens: tokens,
    costUsd,
    activeMs: 0,
  });

  it("adds a known cost to an unknown one", () => {
    const result = sumByKey([
      { key: "w", usage: usage(null, 1) },
      { key: "w", usage: usage(2, 3) },
    ]);

    expect(result.get("w")).toEqual({
      inputTokens: 4,
      outputTokens: 4,
      costUsd: 2,
    });
  });

  it("keeps the cost unknown when no part has one", () => {
    const result = sumByKey([{ key: "w", usage: usage(null, 1) }]);

    expect(result.get("w")?.costUsd).toBeNull();
  });
});
