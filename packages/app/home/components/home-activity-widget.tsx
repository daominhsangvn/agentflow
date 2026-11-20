"use client";

import type {
  OrgActivityDay,
  OrgActivityStats,
} from "@repo/api/src/types/org-stats";
import { DateRangeFilter } from "@repo/app/shared/components/date-range-filter";
import {
  formatCostPrecise,
  formatTokenCount,
  KPI_NO_VALUE,
} from "@repo/app/shared/lib/format-utils";
import {
  TimeSeriesAreaChart,
  type TimeSeriesPointDatum,
  type TimeSeriesSeriesDef,
} from "@repo/design-system/components/ui/time-series-area-chart";
import { useState } from "react";
import { useOrgActivityStats } from "../hooks/use-org-stats";
import { HomeStatCard } from "./home-stat-card";

export const ActivityMetric = {
  Tokens: "tokens",
  Cost: "cost",
  Sessions: "sessions",
  Runs: "runs",
} as const;
export type ActivityMetric =
  (typeof ActivityMetric)[keyof typeof ActivityMetric];

export function ActivityWidget() {
  const query = useOrgActivityStats();
  const [metric, setMetric] = useState<ActivityMetric>(ActivityMetric.Tokens);

  return (
    <HomeStatCard query={query} title="Activity, last 30 days">
      {(data) => (
        <ActivityBody data={data} metric={metric} onMetricChange={setMetric} />
      )}
    </HomeStatCard>
  );
}

function ActivityBody({
  data,
  metric,
  onMetricChange,
}: Readonly<{
  data: OrgActivityStats;
  metric: ActivityMetric;
  onMetricChange: (metric: ActivityMetric) => void;
}>) {
  const config = ACTIVITY_CHARTS[metric];
  const points: TimeSeriesPointDatum[] = data.days.map((day) => ({
    date: day.day,
    values: config.values(day),
  }));

  return (
    <div className="flex flex-col gap-3">
      <DateRangeFilter<ActivityMetric>
        ariaLabel="Activity measure"
        labels={ACTIVITY_METRIC_LABELS}
        onChange={onMetricChange}
        ranges={ACTIVITY_METRICS}
        shortLabels={ACTIVITY_METRIC_LABELS}
        value={metric}
      />
      <div className="h-56" data-testid="activity-chart">
        <TimeSeriesAreaChart
          allowDecimals={metric === ActivityMetric.Cost}
          points={points}
          series={config.series}
          valueFormatter={config.format}
        />
      </div>
      <p className="text-muted-foreground text-sm" data-testid="activity-total">
        {config.total(data.days)}
      </p>
    </div>
  );
}

function sumOf(
  days: readonly OrgActivityDay[],
  pick: (day: OrgActivityDay) => number
): number {
  return days.reduce((total, day) => total + pick(day), 0);
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** Sum of the priced days, or a dash when no day has a known cost. */
function totalCost(days: readonly OrgActivityDay[]): string {
  const priced = days.filter((day) => day.costUsd !== null);
  if (priced.length === 0) {
    return `Total cost: ${KPI_NO_VALUE}`;
  }
  return `Total cost: ${formatCostPrecise(sumOf(priced, (day) => day.costUsd ?? 0))}`;
}

type ActivityChartConfig = {
  series: TimeSeriesSeriesDef[];
  values: (day: OrgActivityDay) => Record<string, number | null>;
  format: (value: number) => string;
  total: (days: readonly OrgActivityDay[]) => string;
};

const ACTIVITY_METRICS: readonly ActivityMetric[] = [
  ActivityMetric.Tokens,
  ActivityMetric.Cost,
  ActivityMetric.Sessions,
  ActivityMetric.Runs,
];

const ACTIVITY_METRIC_LABELS: Record<ActivityMetric, string> = {
  [ActivityMetric.Tokens]: "Tokens",
  [ActivityMetric.Cost]: "Cost",
  [ActivityMetric.Sessions]: "Sessions",
  [ActivityMetric.Runs]: "Runs",
};

const ACTIVITY_CHARTS: Record<ActivityMetric, ActivityChartConfig> = {
  [ActivityMetric.Tokens]: {
    series: [
      { key: "inputTokens", label: "Input tokens" },
      { key: "outputTokens", label: "Output tokens" },
    ],
    values: (day) => ({
      inputTokens: day.inputTokens,
      outputTokens: day.outputTokens,
    }),
    format: formatTokenCount,
    total: (days) =>
      `Total tokens: ${formatTokenCount(
        sumOf(days, (day) => day.inputTokens + day.outputTokens)
      )}`,
  },
  [ActivityMetric.Cost]: {
    series: [{ key: "costUsd", label: "Cost" }],
    values: (day) => ({ costUsd: day.costUsd }),
    format: formatCostPrecise,
    total: totalCost,
  },
  [ActivityMetric.Sessions]: {
    series: [{ key: "sessions", label: "Sessions" }],
    values: (day) => ({ sessions: day.sessions }),
    format: formatCount,
    total: (days) =>
      `Total sessions: ${formatCount(sumOf(days, (day) => day.sessions))}`,
  },
  [ActivityMetric.Runs]: {
    series: [
      { key: "succeeded", label: "Succeeded" },
      { key: "failed", label: "Failed" },
      { key: "cancelled", label: "Cancelled" },
    ],
    values: (day) => ({
      succeeded: day.runsSucceeded,
      failed: day.runsFailed,
      cancelled: day.runsCancelled,
    }),
    format: formatCount,
    total: (days) =>
      `Total runs: ${formatCount(
        sumOf(
          days,
          (day) => day.runsSucceeded + day.runsFailed + day.runsCancelled
        )
      )}`,
  },
};
