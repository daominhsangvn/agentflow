"use client";

import type { OrchestratorCaseListItem } from "@repo/api/src/types/orchestrator";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import {
  type CaseAgentState,
  caseAgentState,
  sortInbox,
} from "../lib/agent-counters";
import { CasePersonBadgeKind, casePersonBadges } from "../lib/case-row-badges";
import { CASE_WAITING_FOR_LABELS } from "../lib/case-waiting-labels";

export type AgentCaseListProps = {
  cases: OrchestratorCaseListItem[];
  /** The selected agent's compute target id; null for the orchestrator. */
  agentId: string | null;
  /** Agent display names by compute target id, for the orchestrator's question badges. */
  agentNames: Readonly<Record<string, string>>;
  nodeLabel: string;
  onSelect: (caseId: string) => void;
  isLoading: boolean;
};

const SKELETON_KEYS = ["a", "b", "c"];

export function AgentCaseList({
  cases,
  agentId,
  agentNames,
  nodeLabel,
  onSelect,
  isLoading,
}: Readonly<AgentCaseListProps>) {
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
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.sourceKey ? (
                  <span className="mr-2 font-mono text-muted-foreground">
                    {item.sourceKey}
                  </span>
                ) : null}
                {item.title}
              </span>
              <CaseRowBadges
                agentId={agentId}
                agentNames={agentNames}
                item={item}
              />
              <span className="shrink-0 text-muted-foreground text-xs">
                {formatRelativeTime(item.updatedAt)}
              </span>
            </button>
          ))}
    </div>
  );
}

function CaseRowBadges({
  item,
  agentId,
  agentNames,
}: {
  item: OrchestratorCaseListItem;
  agentId: string | null;
  agentNames: Readonly<Record<string, string>>;
}) {
  const badges = casePersonBadges(item, agentId, agentNames);
  return (
    <>
      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {badges.map((badge) => (
          <Badge
            data-testid={PERSON_BADGE_TEST_IDS[badge.kind]}
            key={badge.key}
            title={badge.title ?? undefined}
            variant="warning"
          >
            {badge.label}
          </Badge>
        ))}
        {agentId ? (
          <AgentRowState state={caseAgentState(item, agentId)} />
        ) : null}
      </span>
      {badges.length === 0 ? (
        <span className="shrink-0 text-muted-foreground text-xs">
          {CASE_WAITING_FOR_LABELS[item.waitingFor]}
        </span>
      ) : null}
    </>
  );
}

function AgentRowState({ state }: { state: CaseAgentState | null }) {
  if (!state) {
    return null;
  }
  return (
    <>
      {state.running > 0 ? (
        <Badge data-testid="agent-case-running" variant="default">
          {countLabel("Running", state.running)}
        </Badge>
      ) : null}
      {state.queued > 0 ? (
        <Badge
          data-testid="agent-case-queued"
          title={state.waiting ?? undefined}
          variant="muted"
        >
          {countLabel("Queued", state.queued)}
        </Badge>
      ) : null}
      {state.error ? (
        <Badge
          data-testid="agent-case-failed"
          title={state.error}
          variant="error"
        >
          Failed
        </Badge>
      ) : null}
    </>
  );
}

function countLabel(label: string, count: number): string {
  return count > 1 ? `${label} · ${count}` : label;
}

const PERSON_BADGE_TEST_IDS: Record<CasePersonBadgeKind, string> = {
  [CasePersonBadgeKind.Decision]: "agent-case-decision",
  [CasePersonBadgeKind.Questions]: "agent-case-questions",
  [CasePersonBadgeKind.Asked]: "agent-case-asked",
};
