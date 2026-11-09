"use client";

import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
// Cross-slice: the project filter lists the org's projects.
import { useProjects } from "@repo/app/projects/hooks/use-projects";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@repo/app/shared/components/filter-select";
import { useState } from "react";
import { useWorkflows } from "../hooks/use-workflows";
import type { WorkflowRunListFilters } from "../hooks/workflow-keys";
import { WORKFLOW_RUN_STATUS_LABELS } from "../lib/workflow-labels";
import { OrgWorkflowRunHistory } from "./workflow-runs-table";

export type OrgRunsViewProps = {
  /** Scope the runs to one project (hides the project filter). */
  projectId?: string;
};

/** Runs of process-mode workflows across the org (or one project), with filters. */
export function OrgRunsView({ projectId }: Readonly<OrgRunsViewProps>) {
  const [selectedProject, setSelectedProject] = useState<string | undefined>();
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const effectiveProject = projectId ?? selectedProject;
  const projects = useProjects();
  const workflows = useWorkflows();
  const projectOptions: FilterSelectOption[] = (projects.data ?? []).map(
    (project) => ({ value: project.id, label: project.name })
  );
  const workflowOptions: FilterSelectOption[] = (workflows.data ?? [])
    .filter(
      (workflow) =>
        workflow.agent.mode !== WorkflowAgentMode.Orchestrated &&
        (effectiveProject === undefined ||
          workflow.project?.id === effectiveProject)
    )
    .map((workflow) => ({ value: workflow.id, label: workflow.name }));
  const filters: WorkflowRunListFilters = {
    projectId: effectiveProject,
    workflowId,
    status: toRunStatus(status),
  };

  return (
    <div className="space-y-4" data-testid="org-runs-view">
      <div className="flex flex-wrap items-center gap-2">
        {projectId === undefined ? (
          <FilterSelect
            label="Projects"
            onChange={setSelectedProject}
            options={projectOptions}
            value={effectiveProject}
          />
        ) : null}
        <FilterSelect
          label="Workflows"
          onChange={setWorkflowId}
          options={workflowOptions}
          value={workflowId}
        />
        <FilterSelect
          allLabel="All statuses"
          label="Status"
          onChange={setStatus}
          options={RUN_STATUS_FILTER_OPTIONS}
          value={status}
        />
      </div>
      <OrgWorkflowRunHistory filters={filters} />
    </div>
  );
}

function toRunStatus(value: string | undefined): WorkflowRunStatus | undefined {
  return Object.values(WorkflowRunStatus).find((status) => status === value);
}

const RUN_STATUS_FILTER_OPTIONS: readonly FilterSelectOption[] = Object.values(
  WorkflowRunStatus
).map((status) => ({
  value: status,
  label: WORKFLOW_RUN_STATUS_LABELS[status],
}));
