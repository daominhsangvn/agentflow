import type {
  OrchestratorCaseAgent,
  OrchestratorCaseListItem,
} from "@repo/api/src/types/orchestrator";

export const ORCHESTRATOR_NODE_ID = "orchestrator";

export function orchestratorNeedsCount(
  cases: OrchestratorCaseListItem[]
): number {
  return cases.filter((item) => item.needsPerson).length;
}

export function agentNeedsCount(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): number {
  return cases.filter(
    (item) =>
      item.needsPerson &&
      (findAgent(item, computeTargetId)?.openQuestionCount ?? 0) > 0
  ).length;
}

export function agentHasActiveTasks(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): boolean {
  return cases.some(
    (item) => (findAgent(item, computeTargetId)?.activeTaskCount ?? 0) > 0
  );
}

export function agentHasOpenQuestions(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): boolean {
  return cases.some(
    (item) => (findAgent(item, computeTargetId)?.openQuestionCount ?? 0) > 0
  );
}

/** Orchestrator: every case; an agent: the cases it has a task in. */
export function casesForNode(
  cases: OrchestratorCaseListItem[],
  nodeId: string
): OrchestratorCaseListItem[] {
  if (nodeId === ORCHESTRATOR_NODE_ID) {
    return cases;
  }
  return cases.filter((item) => findAgent(item, nodeId) !== undefined);
}

/** Needs-a-person cases first, then newest update first. */
export function sortInbox(
  cases: OrchestratorCaseListItem[]
): OrchestratorCaseListItem[] {
  return [...cases].sort((a, b) => {
    if (a.needsPerson !== b.needsPerson) {
      return a.needsPerson ? -1 : 1;
    }
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

export function agentsInCase(item: OrchestratorCaseListItem): string[] {
  return item.agents.map((agent) => agent.computeTargetId);
}

function findAgent(
  item: OrchestratorCaseListItem,
  computeTargetId: string
): OrchestratorCaseAgent | undefined {
  return item.agents.find((agent) => agent.computeTargetId === computeTargetId);
}
