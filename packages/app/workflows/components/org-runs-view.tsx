"use client";

import {
  WorkflowRunStatus,
  type WorkflowRunsSummary,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { DateRangeFilter } from "@repo/app/shared/components/date-range-filter";
import type { FilterSelectOption } from "@repo/app/shared/components/filter-select";
import {
  SummaryCardRow,
  summaryCardClass,
} from "@repo/app/shared/components/summary-card-row";
import {
  type DateRange,
  getStableUtcDateWindowForRange,
  KPI_NO_VALUE,
} from "@repo/app/shared/lib/format-utils";
import { MetricCard } from "@repo/design-system/components/ui/primitives/metric-card";
import { useState } from "react";
import { useOrgWorkflowRunsSummary } from "../hooks/use-workflows";
import type { WorkflowRunListFilters } from "../hooks/workflow-keys";
import { WORKFLOW_RUN_STATUS_LABELS } from "../lib/workflow-labels";
import { WorkListFilters } from "./work-list-filters";
import { OrgWorkflowRunHistory } from "./workflow-runs-table";

export type OrgRunsViewProps = {
  /** Scope the runs to one project (hides the project filter). */
  projectId?: string;
  /** `page` is the full Sessions-style page; `embedded` stacks inside another panel. */
  layout?: "page" | "embedded";
};

/** Runs of process-mode workflows across the org (or one project), with filters and stats. */
export function OrgRunsView({
  projectId,
  layout = "embedded",
}: Readonly<OrgRunsViewProps>) {
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const effectiveProject = projectId ?? selectedProject;
  const filters: WorkflowRunListFilters = {
    projectId: effectiveProject,
    workflowId,
    status: toRunStatus(status),
    ...getStableUtcDateWindowForRange(dateRange),
  };

  const toolbar = (
    <WorkListFilters
      hideProjectFilter={projectId !== undefined}
      includeWorkflow={isProcessWorkflow}
      onProjectChange={setSelectedProject}
      onStatusChange={setStatus}
      onWorkflowChange={setWorkflowId}
      projectId={effectiveProject}
      status={status}
      statusOptions={RUN_STATUS_FILTER_OPTIONS}
      trailing={<DateRangeFilter onChange={setDateRange} value={dateRange} />}
      workflowId={workflowId}
    />
  );

  if (layout === "page") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="org-runs-view">
        <div className="border-b px-4 py-3">{toolbar}</div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="px-4 pt-3 pb-4">
            <RunsStatsRow filters={filters} />
          </div>
          <div className="px-4 pb-4">
            <OrgWorkflowRunHistory filters={filters} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="org-runs-view">
      {toolbar}
      <RunsStatsRow filters={filters} />
      <OrgWorkflowRunHistory filters={filters} />
    </div>
  );
}

function RunsStatsRow({
  filters,
}: Readonly<{ filters: WorkflowRunListFilters }>) {
  const summary = useOrgWorkflowRunsSummary(filters);
  const cardClass = summaryCardClass(true);
  const unavailable = summary.isError;

  return (
    <SummaryCardRow busy={summary.isLoading} wrapBelow>
      {RUN_STAT_CARDS.map((card) => (
        <MetricCard
          className={cardClass}
          key={card.key}
          label={card.label}
          loading={summary.isLoading}
          value={statValue(summary.data, card.key, unavailable)}
          valueUnavailableLabel={KPI_NO_VALUE}
        />
      ))}
    </SummaryCardRow>
  );
}

function statValue(
  data: WorkflowRunsSummary | undefined,
  key: keyof WorkflowRunsSummary,
  unavailable: boolean
): number | null {
  if (unavailable || data === undefined) {
    return null;
  }
  return data[key];
}

function isProcessWorkflow(workflow: {
  agent: { mode: WorkflowAgentMode };
}): boolean {
  return workflow.agent.mode !== WorkflowAgentMode.Orchestrated;
}

function toRunStatus(value: string | undefined): WorkflowRunStatus | undefined {
  return Object.values(WorkflowRunStatus).find((status) => status === value);
}

const RUN_STAT_CARDS: readonly {
  key: keyof WorkflowRunsSummary;
  label: string;
}[] = [
  { key: "total", label: "Runs" },
  { key: "active", label: "Active" },
  { key: "needsYou", label: "Needs you" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
];

const RUN_STATUS_FILTER_OPTIONS: readonly FilterSelectOption[] = Object.values(
  WorkflowRunStatus
).map((status) => ({
  value: status,
  label: WORKFLOW_RUN_STATUS_LABELS[status],
}));
