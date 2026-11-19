import { AgentKind } from "@repo/api/src/types/agent-fleet";
import type { ComputeTarget } from "@repo/api/src/types/compute-target";
import type { ProjectProcess } from "@repo/api/src/types/project-process";
import { readPersonalAgentProjectKey } from "@repo/api/src/types/project-runners";
import type { SaveWorkflowInput } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import {
  type RunnerFitRunner,
  RunnerFitSeverity,
  runnerFitInTriggerProject,
  workflowRunnerFitProblems,
} from "@repo/api/src/types/workflow-runner-fit";
import {
  CurrentProcessKind,
  projectProcessService,
} from "@/app/projects/project-process-service";

export type FitTarget = { label: string; target: ComputeTarget };

export type FitScope = {
  projectIds: readonly string[];
  projects: readonly { id: string; name: string }[];
};

/**
 * A personal runner only runs process agent steps and never pushes (the same
 * refusals the runner makes at run time), so refuse the save instead of the run.
 */
export async function checkRunnerFit(
  organizationId: string,
  input: SaveWorkflowInput,
  targets: readonly FitTarget[],
  scope: FitScope
): Promise<string | null> {
  if (input.agent.mode === WorkflowAgentMode.Orchestrated) {
    return null;
  }
  const runners: RunnerFitRunner[] = targets.map(({ label, target }) => ({
    label: `${label} (${target.machineName})`,
    kind: readPersonalAgentProjectKey(target.capabilities)
      ? AgentKind.Personal
      : AgentKind.Automatic,
    commands: null,
  }));
  if (!runners.some((runner) => runner.kind === AgentKind.Personal)) {
    return null;
  }
  if (input.agent.process) {
    return firstFitError(input, runners, null);
  }
  const processes = await Promise.all(
    scope.projectIds.map((id) => loadProjectProcess(organizationId, id))
  );
  for (const [index, projectId] of scope.projectIds.entries()) {
    const message = firstFitError(input, runners, processes[index] ?? null);
    if (message) {
      return projectId === input.projectId
        ? message
        : runnerFitInTriggerProject(
            scope.projects.find((project) => project.id === projectId)?.name ??
              projectId,
            message
          );
    }
  }
  return null;
}

function firstFitError(
  input: SaveWorkflowInput,
  runners: RunnerFitRunner[],
  projectProcess: ProjectProcess | null
): string | null {
  const problems = workflowRunnerFitProblems({
    mode: input.agent.mode,
    ownProcess: input.agent.process,
    projectProcess,
    runners,
  });
  return (
    problems.find((problem) => problem.severity === RunnerFitSeverity.Error)
      ?.message ?? null
  );
}

async function loadProjectProcess(
  organizationId: string,
  projectId: string
): Promise<ProjectProcess | null> {
  const current = await projectProcessService.findCurrent(
    organizationId,
    projectId
  );
  return current.kind === CurrentProcessKind.Found
    ? current.snapshot.definition
    : null;
}
