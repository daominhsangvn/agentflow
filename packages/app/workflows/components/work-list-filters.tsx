"use client";

import type { Workflow } from "@repo/api/src/types/workflow";
// Cross-slice: the project filter lists the org's projects.
import { useProjects } from "@repo/app/projects/hooks/use-projects";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@repo/app/shared/components/filter-select";
import type { ReactNode } from "react";
import { useWorkflows } from "../hooks/use-workflows";

export type WorkListFiltersProps = {
  projectId?: string;
  workflowId?: string;
  status?: string;
  onProjectChange: (value: string | undefined) => void;
  onWorkflowChange: (value: string | undefined) => void;
  onStatusChange: (value: string | undefined) => void;
  statusOptions: readonly FilterSelectOption[];
  /** Which workflows the workflow filter offers (before the project narrowing). */
  includeWorkflow: (workflow: Workflow) => boolean;
  hideProjectFilter?: boolean;
  /** Rendered after the selects, e.g. a period control. */
  trailing?: ReactNode;
};

/** Project, Workflow and Status filters shared by the Cases and Runs lists. */
export function WorkListFilters({
  projectId,
  workflowId,
  status,
  onProjectChange,
  onWorkflowChange,
  onStatusChange,
  statusOptions,
  includeWorkflow,
  hideProjectFilter = false,
  trailing,
}: Readonly<WorkListFiltersProps>) {
  const projects = useProjects();
  const workflows = useWorkflows();
  const projectOptions: FilterSelectOption[] = (projects.data ?? []).map(
    (project) => ({ value: project.id, label: project.name })
  );
  const workflowOptions: FilterSelectOption[] = (workflows.data ?? [])
    .filter(
      (workflow) =>
        includeWorkflow(workflow) &&
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
        options={statusOptions}
        value={status}
      />
      {trailing}
    </div>
  );
}
