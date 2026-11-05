"use client";

import type {
  OrgUsageRow,
  OrgUsageTotals,
} from "@repo/api/src/types/org-stats";
import {
  formatCostPrecise,
  formatTokenCount,
} from "@repo/app/shared/lib/format-utils";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
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
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="font-medium text-sm">{TOP_LIST_TITLE}</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <TopList
                hrefPrefix="/orchestrator/cases"
                rows={data.topCases}
                title="Cases"
              />
              <TopList
                hrefPrefix="/workflows"
                rows={data.topWorkflows}
                title="Workflows"
              />
              <TopList
                hrefPrefix="/projects"
                rows={data.topProjects}
                title="Projects"
              />
              <TopList
                hrefPrefix="/agents"
                rows={data.topAgents}
                title="Agents"
              />
            </div>
          </div>
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

function TopList({
  title,
  rows,
  hrefPrefix,
}: Readonly<{ title: string; rows: OrgUsageRow[]; hrefPrefix: string }>) {
  const buildOrgPath = useOrgPath();
  return (
    <div className="flex flex-col gap-1" data-testid={`top-${title}`}>
      <span className="text-muted-foreground text-xs">{title}</span>
      {rows.length === 0 ? (
        <span className="text-muted-foreground text-sm">None yet</span>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {rows.map((row) => (
            <li className="flex justify-between gap-2" key={row.id}>
              <Link
                className="truncate hover:underline"
                href={buildOrgPath(`${hrefPrefix}/${row.id}`)}
              >
                {row.name}
              </Link>
              <span className="tabular-nums">{formatRowCost(row.costUsd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRowCost(cost: number | null): string {
  if (cost === null || !Number.isFinite(cost)) {
    return "-";
  }
  return formatCostPrecise(cost);
}
