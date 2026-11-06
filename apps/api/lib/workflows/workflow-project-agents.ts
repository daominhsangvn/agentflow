import { readProjectRunnerIds } from "@repo/api/src/types/project-runners";
import type { SaveWorkflowInput } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";

export type WorkflowAgentRef = { label: string; computeTargetId: string };

/**
 * The first Agent that is not one of the Agents of a project listing Agents,
 * as an error message; null when every Agent is allowed. A project without
 * Agents accepts any Agent.
 */
export function projectAgentsError(input: {
  projects: { id: string; name: string; settings: unknown }[];
  agents: WorkflowAgentRef[];
  agentNames: Map<string, string>;
}): string | null {
  for (const project of input.projects) {
    const allowed = readProjectRunnerIds(project.settings);
    if (allowed.length === 0) {
      continue;
    }
    const outside = input.agents.find(
      (agent) => !allowed.includes(agent.computeTargetId)
    );
    if (outside) {
      const name =
        input.agentNames.get(outside.computeTargetId) ??
        outside.computeTargetId;
      return `${outside.label} (${name}) is not one of the Agents of project ${project.name}. Choose one of its Agents, or add it on Project → Agents.`;
    }
  }
  return null;
}

/** The workflow's default Agent followed by its runner rules' Agents, labelled. */
export function workflowAgentRefs(
  input: SaveWorkflowInput
): WorkflowAgentRef[] {
  const orchestrated = input.agent.mode === WorkflowAgentMode.Orchestrated;
  return [
    {
      label: orchestrated ? "The orchestrator's Agent" : "The workflow's Agent",
      computeTargetId: input.agent.computeTargetId,
    },
    ...(input.agent.runners ?? []).map((rule, index) => ({
      label: `Runner rule ${index + 1}'s Agent`,
      computeTargetId: rule.computeTargetId,
    })),
  ];
}
