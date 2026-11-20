"use client";

import {
  type OrchestratorCaseListItem,
  type OrchestratorCaseListSummary,
  OrchestratorCaseStatus,
} from "@repo/api/src/types/orchestrator";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
// Cross-slice: same provider icon as the workflow runs table.
import { ProviderIcon } from "@repo/app/integrations/components/provider-icon";
// Cross-slice: same retryable error block as the repositories list.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import type { FilterSelectOption } from "@repo/app/shared/components/filter-select";
import {
  SummaryCardRow,
  summaryCardClass,
} from "@repo/app/shared/components/summary-card-row";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { formatActiveTime } from "@repo/app/shared/lib/format-active-time";
import {
  formatCostPrecise,
  formatTokenCount,
  KPI_NO_VALUE,
} from "@repo/app/shared/lib/format-utils";
// Cross-slice: the same project, workflow and status filters as the runs list.
import { WorkListFilters } from "@repo/app/workflows/components/work-list-filters";
import { Badge } from "@repo/design-system/components/ui/badge";
import { EmptyState } from "@repo/design-system/components/ui/empty-state";
import { MetricCard } from "@repo/design-system/components/ui/primitives/metric-card";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
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
import { InboxIcon } from "lucide-react";
import { useState } from "react";
import {
  isCaseActive,
  useOrgOrchestratorCases,
  useOrgOrchestratorCasesSummary,
} from "../hooks/use-orchestrator-cases";
import { caseSourceProvider } from "../lib/case-source";
import { CASE_WAITING_FOR_LABELS } from "../lib/case-waiting-labels";

const ACTIVE_TIME_HINT =
  "Summed duration of the agent sessions and orchestrator turns of the case";

const STATUS_OPTIONS: readonly FilterSelectOption[] = [
  { value: OrchestratorCaseStatus.Open, label: "Open" },
  { value: OrchestratorCaseStatus.Closed, label: "Closed" },
];

export type OrgCaseListProps = {
  /** Scope the list to one project (hides the project filter). */
  projectId?: string;
  hideProjectFilter?: boolean;
  /** `page` is the full Sessions-style page; `embedded` stacks inside another panel. */
  layout?: "page" | "embedded";
};

/** Every orchestrator case of the org (or of one project), with filters and stats. */
export function OrgCaseList({
  projectId,
  hideProjectFilter = false,
  layout = "embedded",
}: Readonly<OrgCaseListProps>) {
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const effectiveProject = projectId ?? selectedProject;
  const query = {
    projectId: effectiveProject,
    workflowId,
    status: toCaseStatus(status),
  };
  const cases = useOrgOrchestratorCases(query);
  const summary = useOrgOrchestratorCasesSummary(query, {
    poll: cases.data?.some((item) => isCaseActive(item)) ?? false,
  });

  const toolbar = (
    <WorkListFilters
      hideProjectFilter={hideProjectFilter || projectId !== undefined}
      includeWorkflow={isOrchestratedWorkflow}
      onProjectChange={setSelectedProject}
      onStatusChange={setStatus}
      onWorkflowChange={setWorkflowId}
      projectId={effectiveProject}
      status={status}
      statusOptions={STATUS_OPTIONS}
      workflowId={workflowId}
    />
  );

  if (layout === "page") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="org-case-list">
        <div className="border-b px-4 py-3">{toolbar}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="px-4 pt-3 pb-4">
            <CaseStatsRow summary={summary} />
          </div>
          <div className="px-4 pb-4">
            <CaseTable cases={cases} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="org-case-list">
      {toolbar}
      <CaseStatsRow summary={summary} />
      <CaseTable cases={cases} />
    </div>
  );
}

function CaseStatsRow({
  summary,
}: Readonly<{ summary: ReturnType<typeof useOrgOrchestratorCasesSummary> }>) {
  const cardClass = summaryCardClass(true);

  return (
    <SummaryCardRow busy={summary.isLoading} wrapBelow>
      {CASE_STAT_CARDS.map((card) => (
        <MetricCard
          className={cardClass}
          key={card.key}
          label={card.label}
          loading={summary.isLoading}
          value={summary.isError ? null : (summary.data?.[card.key] ?? null)}
          valueUnavailableLabel={KPI_NO_VALUE}
        />
      ))}
    </SummaryCardRow>
  );
}

function isOrchestratedWorkflow(workflow: {
  agent: { mode: WorkflowAgentMode };
}): boolean {
  return workflow.agent.mode === WorkflowAgentMode.Orchestrated;
}

const CASE_STAT_CARDS: readonly {
  key: keyof OrchestratorCaseListSummary;
  label: string;
}[] = [
  { key: "total", label: "Cases" },
  { key: "open", label: "Open" },
  { key: "needsPerson", label: "Needs a person" },
  { key: "closed", label: "Closed" },
];

function CaseTable({
  cases,
}: Readonly<{ cases: ReturnType<typeof useOrgOrchestratorCases> }>) {
  const buildOrgPath = useOrgPath();

  if (cases.isLoading) {
    return (
      <div aria-label="Loading cases" className="space-y-2" role="status">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (cases.error || !cases.data) {
    return (
      <QueryErrorMessage
        error={cases.error}
        onRetry={() => {
          cases.refetch();
        }}
        title="Couldn't load the cases"
      />
    );
  }
  if (cases.data.length === 0) {
    return (
      <EmptyState
        description="A request on one of the orchestrated workflows' triggers opens one."
        icon={InboxIcon}
        size="compact"
        title="No cases match."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Waiting for</TableHead>
            <TableHead>Agents</TableHead>
            <TableHead title={ACTIVE_TIME_HINT}>Active time</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cases.data.map((item) => (
            <OrgCaseRow buildOrgPath={buildOrgPath} item={item} key={item.id} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function OrgCaseRow({
  item,
  buildOrgPath,
}: Readonly<{
  item: OrchestratorCaseListItem;
  buildOrgPath: (path: string) => string;
}>) {
  const provider = caseSourceProvider(item.sourceKey);

  return (
    <TableRow>
      <TableCell className="max-w-[22rem]">
        <div className="flex min-w-0 items-center gap-2">
          {provider ? <ProviderIcon provider={provider} /> : null}
          <div className="min-w-0">
            <Link
              className="block truncate font-medium hover:underline"
              href={buildOrgPath(`/orchestrator/cases/${item.id}`)}
            >
              {item.title}
            </Link>
            {item.sourceKey ? (
              <span className="block truncate text-muted-foreground text-xs">
                {item.sourceKey}
              </span>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>{item.project.name}</TableCell>
      <TableCell>
        <Link
          className="hover:underline"
          href={buildOrgPath(`/workflows/${item.workflow.id}?tab=cases`)}
        >
          {item.workflow.name}
        </Link>
      </TableCell>
      <TableCell>
        <CaseStatus item={item} />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {CASE_WAITING_FOR_LABELS[item.waitingFor]}
      </TableCell>
      <TableCell>
        {item.runningAgents.length > 0 ? item.runningAgents.join(", ") : "-"}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        <div>{formatActiveTime(item.activeMs)}</div>
        <div className="text-muted-foreground text-xs">
          {`elapsed ${formatElapsed(item)}`}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {formatTokenCount(item.inputTokens + item.outputTokens)}
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        {item.costUsd === null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          formatCostPrecise(item.costUsd)
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(item.updatedAt)}
      </TableCell>
    </TableRow>
  );
}

function CaseStatus({ item }: Readonly<{ item: OrchestratorCaseListItem }>) {
  const isOpen = item.status === OrchestratorCaseStatus.Open;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={isOpen ? "default" : "outline"}>
        {isOpen ? "Open" : "Closed"}
      </Badge>
      {isCaseActive(item) ? <Badge variant="info">Running</Badge> : null}
    </div>
  );
}

function formatElapsed(item: OrchestratorCaseListItem): string {
  const end = item.closedAt ? Date.parse(item.closedAt) : Date.now();
  return formatActiveTime(end - Date.parse(item.createdAt));
}

function toCaseStatus(
  value: string | undefined
): OrchestratorCaseStatus | undefined {
  if (value === OrchestratorCaseStatus.Open) {
    return OrchestratorCaseStatus.Open;
  }
  if (value === OrchestratorCaseStatus.Closed) {
    return OrchestratorCaseStatus.Closed;
  }
  return undefined;
}
