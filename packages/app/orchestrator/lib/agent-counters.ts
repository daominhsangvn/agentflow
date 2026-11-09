import {
  type OrchestratorCaseAgent,
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";

export const ORCHESTRATOR_NODE_ID = "orchestrator";

export function orchestratorNeedsCount(
  cases: OrchestratorCaseListItem[]
): number {
  return cases.filter((item) => item.needsPerson).length;
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

/** Newest update first. */
export function sortInbox(
  cases: OrchestratorCaseListItem[]
): OrchestratorCaseListItem[] {
  return [...cases].sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  );
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

export const LATEST_TASK_FAILED = "The latest task failed.";

export type CaseAgentState = {
  running: number;
  queued: number;
  waiting: string | null;
  needsPerson: boolean;
  error: string | null;
};

/** Queued + running tasks of the agent across the cases. */
export function agentActiveTaskCount(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): number {
  return cases.reduce(
    (sum, item) =>
      sum + (findAgent(item, computeTargetId)?.activeTaskCount ?? 0),
    0
  );
}

export function agentNeedsPerson(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): boolean {
  return cases.some(
    (item) =>
      item.needsPerson &&
      (findAgent(item, computeTargetId)?.openQuestionCount ?? 0) > 0
  );
}

/** Error of the agent's failed latest task in the newest open case, if any. */
export function agentLatestError(
  cases: OrchestratorCaseListItem[],
  computeTargetId: string
): string | null {
  const failed = cases
    .filter((item) => item.status !== OrchestratorCaseStatus.Closed)
    .filter(
      (item) =>
        findAgent(item, computeTargetId)?.latestTaskStatus ===
        OrchestratorTaskStatus.Failed
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (failed.length === 0) {
    return null;
  }
  return (
    findAgent(failed[0], computeTargetId)?.latestTaskError ?? LATEST_TASK_FAILED
  );
}

export function caseAgentState(
  item: OrchestratorCaseListItem,
  computeTargetId: string
): CaseAgentState | null {
  const agent = findAgent(item, computeTargetId);
  if (!agent) {
    return null;
  }
  const failed = agent.latestTaskStatus === OrchestratorTaskStatus.Failed;
  return {
    running: agent.runningTaskCount,
    queued: agent.queuedTaskCount,
    waiting: agent.latestTaskWaiting,
    needsPerson: agent.openQuestionCount > 0,
    error: failed ? (agent.latestTaskError ?? LATEST_TASK_FAILED) : null,
  };
}
