import { AgentKind } from "@repo/api/src/types/agent-fleet";
import type {
  WorkflowAgentMap,
  WorkflowAgentMapAgent,
  WorkflowAgentMapNode,
} from "@repo/api/src/types/orchestrator";
import {
  type ComputeTargetCapabilities,
  RunnerCapabilitiesSource,
} from "@repo/api/src/types/runner-capabilities";
import { withDb } from "@repo/database";
import { computeTargetCapabilitiesService } from "@/app/compute-targets/capabilities-service";
import { agentKind } from "@/app/compute-targets/fleet-service";
import { loadOrchestratorWorkflows } from "@/lib/orchestrator/workflow-settings";

/**
 * The Agents tab's diagram (GET /workflows/{id}/agents): the workflow's
 * orchestrator and every agent of its project: the ones that declared an
 * AGENTFLOW.md, and the ones that only ran a task of the workflow's cases.
 */

export async function loadWorkflowAgentMap(
  organizationId: string,
  workflowId: string
): Promise<WorkflowAgentMap | null> {
  const workflow = await withDb((db) =>
    db.workflow.findFirst({
      where: { id: workflowId, organizationId },
      select: { id: true, projectId: true },
    })
  );
  if (!workflow) {
    return null;
  }
  const [settings, files, taskRows] = await Promise.all([
    loadOrchestratorWorkflows(organizationId, [workflowId]),
    workflow.projectId
      ? computeTargetCapabilitiesService.listForProject(
          organizationId,
          workflow.projectId
        )
      : Promise.resolve([]),
    withDb((db) =>
      db.orchestratorTask.findMany({
        where: {
          organizationId,
          case: { workflowId },
          computeTargetId: { not: null },
        },
        distinct: ["computeTargetId"],
        select: {
          computeTarget: {
            select: {
              id: true,
              machineName: true,
              isOnline: true,
              capabilities: true,
            },
          },
        },
      })
    ),
  ]);
  const orchestratorId = settings.get(workflowId)?.computeTargetId ?? null;
  const orchestrator = orchestratorId
    ? await loadNode(organizationId, orchestratorId)
    : null;
  const declared = declaredAgents(files);
  const undeclared = taskRows
    .flatMap((row) => (row.computeTarget ? [row.computeTarget] : []))
    .filter(
      (target) =>
        target.id !== orchestratorId &&
        !declared.some((agent) => agent.computeTargetId === target.id)
    )
    .map(undeclaredAgent);
  const agents = [...declared, ...undeclared].sort(compareAgents);
  return { orchestrator, agents };
}

async function loadNode(
  organizationId: string,
  computeTargetId: string
): Promise<WorkflowAgentMapNode | null> {
  const target = await withDb((db) =>
    db.computeTarget.findFirst({
      where: { id: computeTargetId, organizationId },
      select: { id: true, machineName: true, isOnline: true },
    })
  );
  if (!target) {
    return null;
  }
  return {
    computeTargetId: target.id,
    name: target.machineName,
    isOnline: target.isOnline,
  };
}

/** One agent per compute target (the files come newest first). */
function declaredAgents(
  files: ComputeTargetCapabilities[]
): WorkflowAgentMapAgent[] {
  const seen = new Set<string>();
  const agents: WorkflowAgentMapAgent[] = [];
  for (const file of files) {
    if (seen.has(file.computeTargetId)) {
      continue;
    }
    seen.add(file.computeTargetId);
    agents.push({
      computeTargetId: file.computeTargetId,
      name: file.runnerName,
      isOnline: file.isOnline,
      role: file.capabilities?.runner ?? null,
      kind: kindOfSource(file.source),
      declared: true,
    });
  }
  return agents;
}

function undeclaredAgent(target: {
  id: string;
  machineName: string;
  isOnline: boolean;
  capabilities: unknown;
}): WorkflowAgentMapAgent {
  return {
    computeTargetId: target.id,
    name: target.machineName,
    isOnline: target.isOnline,
    role: null,
    kind: agentKind(target.capabilities),
    declared: false,
  };
}

function kindOfSource(source: RunnerCapabilitiesSource): AgentKind {
  if (source === RunnerCapabilitiesSource.Personal) {
    return AgentKind.Personal;
  }
  return AgentKind.Automatic;
}

/** Declared agents first, then by name. */
function compareAgents(
  a: WorkflowAgentMapAgent,
  b: WorkflowAgentMapAgent
): number {
  if (a.declared !== b.declared) {
    return a.declared ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
