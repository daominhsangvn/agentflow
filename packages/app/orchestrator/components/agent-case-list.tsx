"use client";

import type { OrchestratorCaseListItem } from "@repo/api/src/types/orchestrator";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { cn } from "@repo/design-system/lib/utils";
import { sortInbox } from "../lib/agent-counters";
import { CASE_WAITING_FOR_LABELS } from "../lib/case-waiting-labels";

export type AgentCaseListProps = {
  cases: OrchestratorCaseListItem[];
  nodeLabel: string;
  onSelect: (caseId: string) => void;
  isLoading: boolean;
};

const SKELETON_KEYS = ["a", "b", "c"];

export function AgentCaseList({
  cases,
  nodeLabel,
  onSelect,
  isLoading,
}: AgentCaseListProps) {
  const rows = sortInbox(cases);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">
        {nodeLabel} · {cases.length} {cases.length === 1 ? "case" : "cases"}
      </h3>
      {isLoading ? (
        <div className="flex flex-col gap-2" data-testid="agent-case-loading">
          {SKELETON_KEYS.map((key) => (
            <Skeleton className="h-12 w-full" key={key} />
          ))}
        </div>
      ) : null}
      {!isLoading && rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No cases yet</p>
      ) : null}
      {isLoading
        ? null
        : rows.map((item) => (
            <button
              className="flex items-center gap-3 rounded-md border p-3 text-left hover:bg-muted/50"
              data-testid="agent-case-row"
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  item.needsPerson ? "bg-warning" : "bg-transparent"
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.sourceKey ? (
                  <span className="mr-2 font-mono text-muted-foreground">
                    {item.sourceKey}
                  </span>
                ) : null}
                {item.title}
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">
                {item.needsPerson
                  ? "Needs answer"
                  : CASE_WAITING_FOR_LABELS[item.waitingFor]}
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">
                {formatRelativeTime(item.updatedAt)}
              </span>
            </button>
          ))}
    </div>
  );
}
