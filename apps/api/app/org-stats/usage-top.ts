import {
  ORG_STATS_TOP_ROWS,
  type OrgUsageRow,
  type OrgUsageTotals,
} from "@repo/api/src/types/org-stats";
import { addCost, type UsageTotals } from "@/lib/usage/loop-usage";

/** Pure ranking and summing for the Home "top" lists. */

export function sumByKey(
  units: { key: string; usage: UsageTotals }[]
): Map<string, OrgUsageTotals> {
  const totals = new Map<string, OrgUsageTotals>();
  for (const { key, usage } of units) {
    const current = totals.get(key) ?? {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    };
    totals.set(key, {
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      costUsd: addCost(current.costUsd, usage.costUsd),
    });
  }
  return totals;
}

/** By cost descending (unknown cost last), then total tokens; unnamed ids are dropped. */
export function topRows(
  totals: Map<string, OrgUsageTotals>,
  names: Map<string, string>,
  max: number = ORG_STATS_TOP_ROWS
): OrgUsageRow[] {
  const rows: OrgUsageRow[] = [];
  for (const [id, usage] of totals) {
    const name = names.get(id);
    if (name !== undefined) {
      rows.push({ id, name, ...usage });
    }
  }
  return rows.sort((a, b) => compareRows(a, b)).slice(0, max);
}

function compareRows(a: OrgUsageRow, b: OrgUsageRow): number {
  if (a.costUsd !== b.costUsd) {
    if (a.costUsd === null) {
      return 1;
    }
    if (b.costUsd === null) {
      return -1;
    }
    return b.costUsd - a.costUsd;
  }
  return b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens);
}
