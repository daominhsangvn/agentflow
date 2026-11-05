"use client";

import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
// Cross-slice: the project's cases list.
import { OrgCaseList } from "@repo/app/orchestrator/components/org-case-list";
// Cross-slice: the project's workflows and process-mode runs.
import { OrgRunsView } from "@repo/app/workflows/components/org-runs-view";
// Cross-slice: the org's workflows, filtered to this project.
import { useWorkflows } from "@repo/app/workflows/hooks/use-workflows";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";

export type ProjectWorkflowsCasesPanelProps = {
  projectId: string;
};

/** Workflows, cases and (for process workflows) runs of one project. */
export function ProjectWorkflowsCasesPanel({
  projectId,
}: Readonly<ProjectWorkflowsCasesPanelProps>) {
  const buildOrgPath = useOrgPath();
  const workflows = useWorkflows();
  const projectWorkflows = (workflows.data ?? []).filter(
    (workflow) => workflow.project?.id === projectId
  );
  const hasProcessWorkflow = projectWorkflows.some(
    (workflow) => workflow.agent.mode !== WorkflowAgentMode.Orchestrated
  );

  return (
    <div className="mx-auto flex max-w-[950px] flex-col gap-8 p-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Workflows</h2>
          <Link
            className="text-sm underline-offset-2 hover:underline"
            href={buildOrgPath("/workflows/new")}
          >
            New workflow
          </Link>
        </div>
        {projectWorkflows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No workflows in this project yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projectWorkflows.map((workflow) => (
              <li className="flex items-center gap-2" key={workflow.id}>
                <Link
                  className="font-medium hover:underline"
                  href={buildOrgPath(`/workflows/${workflow.id}`)}
                >
                  {workflow.name}
                </Link>
                <Badge variant="outline">
                  {workflow.agent.mode === WorkflowAgentMode.Orchestrated
                    ? "Orchestrated"
                    : "Process"}
                </Badge>
                <Badge variant="secondary">
                  {workflow.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-lg">Cases</h2>
        <OrgCaseList projectId={projectId} />
      </section>
      {hasProcessWorkflow ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-lg">Runs</h2>
          <OrgRunsView projectId={projectId} />
        </section>
      ) : null}
    </div>
  );
}
