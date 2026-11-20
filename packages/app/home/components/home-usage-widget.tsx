"use client";

import type {
  OrgUsageRow,
  OrgUsageStats,
  OrgUsageTotals,
} from "@repo/api/src/types/org-stats";
import { DateRangeFilter } from "@repo/app/shared/components/date-range-filter";
import {
  formatCostPrecise,
  formatTokenCount,
} from "@repo/app/shared/lib/format-utils";
import { CategoryBarChart } from "@repo/design-system/components/ui/category-bar-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { useState } from "react";
import { useOrgUsageStats } from "../hooks/use-org-stats";
import { HomeStatCard, StatValue } from "./home-stat-card";

const TOP_LIST_TITLE = "Top cost (cases and runs active in the last 30 days)";

export function UsageWidget() {
  const query = useOrgUsageStats();
  return (
    <HomeStatCard
      footer={
        <p className="text-muted-foreground text-xs">
          Includes every agent session (automatic and personal agents, desktop),
          agent loops without a synced session, and orchestrator turns.
        </p>
      }
      query={query}
      title="Usage"
    >
      {(data) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <UsagePeriod label="Last 7 days" totals={data.last7d} />
            <UsagePeriod label="Last 30 days" totals={data.last30d} />
          </div>
          <UsageBreakdown stats={data} />
        </>
      )}
    </HomeStatCard>
  );
}

function UsagePeriod({
  label,
  totals,
}: Readonly<{ label: string; totals: OrgUsageTotals }>) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-sm">{label}</span>
      <StatValue
        format={formatTokenCount}
        label="Input tokens"
        value={totals.inputTokens}
      />
      <StatValue
        format={formatTokenCount}
        label="Output tokens"
        value={totals.outputTokens}
      />
      <StatValue
        format={formatCostPrecise}
        label="Cost"
        value={totals.costUsd}
      />
    </div>
  );
}

function UsageBreakdown({ stats }: Readonly<{ stats: OrgUsageStats }>) {
  const [dimension, setDimension] = useState<UsageDimension>(
    UsageDimension.Cases
  );
  const config = USAGE_DIMENSIONS[dimension];
  const rows = stats[config.rowsKey];

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <span className="font-medium text-sm">{TOP_LIST_TITLE}</span>
      <DateRangeFilter<UsageDimension>
        ariaLabel="Usage breakdown"
        labels={USAGE_DIMENSION_LABELS}
        onChange={setDimension}
        ranges={USAGE_DIMENSION_ORDER}
        shortLabels={USAGE_DIMENSION_LABELS}
        value={dimension}
      />
      <div
        className="grid gap-4 lg:grid-cols-2"
        data-testid={`top-${USAGE_DIMENSION_LABELS[dimension]}`}
      >
        <UsageCostChart rows={rows} />
        <UsageTable hrefPrefix={config.hrefPrefix} rows={rows} />
      </div>
    </div>
  );
}

function UsageCostChart({ rows }: Readonly<{ rows: OrgUsageRow[] }>) {
  const data = rows.flatMap((row) =>
    row.costUsd !== null && Number.isFinite(row.costUsd)
      ? [{ key: row.id, label: row.name, value: row.costUsd }]
      : []
  );
  return (
    <div className="h-56" data-testid="usage-cost-chart">
      <CategoryBarChart
        allowDecimals
        data={data}
        emptyMessage="No priced usage"
        horizontal
        valueFormatter={formatCostPrecise}
      />
    </div>
  );
}

function UsageTable({
  rows,
  hrefPrefix,
}: Readonly<{ rows: OrgUsageRow[]; hrefPrefix: string }>) {
  const buildOrgPath = useOrgPath();
  if (rows.length === 0) {
    return <span className="text-muted-foreground text-sm">None yet</span>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-48 truncate">
              <Link
                className="hover:underline"
                href={buildOrgPath(`${hrefPrefix}/${row.id}`)}
              >
                {row.name}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokenCount(row.inputTokens + row.outputTokens)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatRowCost(row.costUsd)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatRowCost(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost)) {
    return "-";
  }
  return formatCostPrecise(cost);
}

const UsageDimension = {
  Cases: "cases",
  Workflows: "workflows",
  Projects: "projects",
  Agents: "agents",
} as const;
type UsageDimension = (typeof UsageDimension)[keyof typeof UsageDimension];

const USAGE_DIMENSION_ORDER: readonly UsageDimension[] = [
  UsageDimension.Cases,
  UsageDimension.Workflows,
  UsageDimension.Projects,
  UsageDimension.Agents,
];

const USAGE_DIMENSION_LABELS: Record<UsageDimension, string> = {
  [UsageDimension.Cases]: "Cases",
  [UsageDimension.Workflows]: "Workflows",
  [UsageDimension.Projects]: "Projects",
  [UsageDimension.Agents]: "Agents",
};

const USAGE_DIMENSIONS: Record<
  UsageDimension,
  {
    rowsKey: "topCases" | "topWorkflows" | "topProjects" | "topAgents";
    hrefPrefix: string;
  }
> = {
  [UsageDimension.Cases]: {
    rowsKey: "topCases",
    hrefPrefix: "/orchestrator/cases",
  },
  [UsageDimension.Workflows]: {
    rowsKey: "topWorkflows",
    hrefPrefix: "/workflows",
  },
  [UsageDimension.Projects]: {
    rowsKey: "topProjects",
    hrefPrefix: "/projects",
  },
  [UsageDimension.Agents]: { rowsKey: "topAgents", hrefPrefix: "/agents" },
};
