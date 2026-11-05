"use client";

import {
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
} from "@repo/api/src/types/orchestrator";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
// Cross-slice: same provider icon as the workflow runs table.
import { ProviderIcon } from "@repo/app/integrations/components/provider-icon";
// Cross-slice: same retryable error block as the repositories list.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
// Cross-slice: the project filter lists the org's projects.
import { useProjects } from "@repo/app/projects/hooks/use-projects";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@repo/app/shared/components/filter-select";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { formatActiveTime } from "@repo/app/shared/lib/format-active-time";
import {
  formatCostPrecise,
  formatTokenCount,
} from "@repo/app/shared/lib/format-utils";
// Cross-slice: the workflow filter lists the org's orchestrated workflows.
import { useWorkflows } from "@repo/app/workflows/hooks/use-workflows";
import { Badge } from "@repo/design-system/components/ui/badge";
import { EmptyState } from "@repo/design-system/components/ui/empty-state";
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
};

/** Every orchestrator case of the org (or of one project), with filters. */
export function OrgCaseList({
  projectId,
  hideProjectFilter = false,
}: Readonly<OrgCaseListProps>) {
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const effectiveProject = projectId ?? selectedProject;
  const cases = useOrgOrchestratorCases({
    projectId: effectiveProject,
    workflowId,
    status: toCaseStatus(status),
  });

  return (
    <div className="space-y-4" data-testid="org-case-list">
      <CaseFilters
        hideProjectFilter={hideProjectFilter || projectId !== undefined}
        onProjectChange={setSelectedProject}
        onStatusChange={setStatus}
        onWorkflowChange={setWorkflowId}
        projectId={effectiveProject}
        status={status}
        workflowId={workflowId}
      />
      <CaseTable cases={cases} />
    </div>
  );
}

function CaseFilters({
  hideProjectFilter,
  projectId,
  workflowId,
  status,
  onProjectChange,
  onWorkflowChange,
  onStatusChange,
}: Readonly<{
  hideProjectFilter: boolean;
  projectId: string | undefined;
  workflowId: string | undefined;
  status: string | undefined;
  onProjectChange: (value: string | undefined) => void;
  onWorkflowChange: (value: string | undefined) => void;
  onStatusChange: (value: string | undefined) => void;
}>) {
  const projects = useProjects();
  const workflows = useWorkflows();
  const projectOptions: FilterSelectOption[] = (projects.data ?? []).map(
    (project) => ({ value: project.id, label: project.name })
  );
  const workflowOptions: FilterSelectOption[] = (workflows.data ?? [])
    .filter(
      (workflow) =>
        workflow.agent.mode === WorkflowAgentMode.Orchestrated &&
        (projectId === undefined || workflow.project?.id === projectId)
    )
    .map((workflow) => ({ value: workflow.id, label: workflow.name }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hideProjectFilter ? null : (
        <FilterSelect
          label="Projects"
          onChange={onProjectChange}
          options={projectOptions}
          value={projectId}
        />
      )}
      <FilterSelect
        label="Workflows"
        onChange={onWorkflowChange}
        options={workflowOptions}
        value={workflowId}
      />
      <FilterSelect
        allLabel="All statuses"
        label="Status"
        onChange={onStatusChange}
        options={STATUS_OPTIONS}
        value={status}
      />
    </div>
  );
}

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
