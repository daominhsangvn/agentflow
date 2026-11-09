"use client";

import {
  type OrgAttentionItem,
  OrgAttentionKind,
  type OrgAttentionStats,
} from "@repo/api/src/types/org-stats";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { useOrgAttentionStats } from "../hooks/use-org-stats";
import { HomeStatCard, StatValue } from "./home-stat-card";

const KIND_LABELS: Record<OrgAttentionKind, string> = {
  [OrgAttentionKind.WaitingForHuman]: "Waiting for a person",
  [OrgAttentionKind.PendingDecision]: "Pending decision",
  [OrgAttentionKind.BlockedTask]: "Blocked task",
  [OrgAttentionKind.FailedTask]: "Failed task",
  [OrgAttentionKind.OfflineAgent]: "Offline agent",
};

export function AttentionWidget() {
  const query = useOrgAttentionStats();
  return (
    <HomeStatCard query={query} title="Attention">
      {(data) => (
        <>
          <RatesRow stats={data} />
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="font-medium text-sm">Needs attention</span>
            {data.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing needs attention.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.items.map((item, index) => (
                  <AttentionRow
                    item={item}
                    key={`${item.kind}-${item.caseId ?? item.computeTargetId ?? index}`}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </HomeStatCard>
  );
}

function RatesRow({ stats }: Readonly<{ stats: OrgAttentionStats }>) {
  const { succeeded, failed, blocked } = stats.tasks7d;
  const denominator = succeeded + failed + blocked;
  const rate = denominator === 0 ? null : (succeeded / denominator) * 100;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <StatValue
        format={(value) => `${Math.round(value)}%`}
        label="Task success (7 days)"
        value={rate}
      />
      <StatValue label="Failed tasks" value={failed} />
      <StatValue label="Blocked tasks" value={blocked} />
      <StatValue label="Failed runs (7 days)" value={stats.failedRuns7d} />
      <StatValue
        label="Guard refusals (7 days)"
        value={stats.guardRefusals7d}
      />
    </div>
  );
}

function AttentionRow({ item }: Readonly<{ item: OrgAttentionItem }>) {
  const buildOrgPath = useOrgPath();
  const context = [item.projectName, item.workflowName]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-0.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {KIND_LABELS[item.kind]}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatRelativeTime(item.since)}
        </span>
      </div>
      <Link
        className="font-medium hover:underline"
        href={buildOrgPath(resolveItemPath(item))}
      >
        {item.title}
      </Link>
      {context ? (
        <span className="text-muted-foreground text-xs">{context}</span>
      ) : null}
      {item.detail ? (
        <span className="text-muted-foreground text-xs">{item.detail}</span>
      ) : null}
    </li>
  );
}

function resolveItemPath(item: OrgAttentionItem): string {
  if (item.caseId) {
    return `/orchestrator/cases/${item.caseId}`;
  }
  if (item.computeTargetId) {
    return `/agents/${item.computeTargetId}`;
  }
  return "/agents";
}
