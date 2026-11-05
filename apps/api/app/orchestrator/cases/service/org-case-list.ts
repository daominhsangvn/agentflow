import {
  type OrchestratorCaseListItem,
  type OrchestratorCaseListQuery,
  OrchestratorCaseStatus,
  type OrchestratorCaseSummary,
  OrchestratorCaseWaitingFor,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";

/**
 * Org-wide case list reads: the most recently updated cases and, for them, what
 * each is waiting for. One query per table, no per-case fan-out.
 */

const ORG_CASES_MAX = 100;

export type CaseWaitState = {
  waitingConversation: Set<string>;
  openWait: Set<string>;
  /** Machine names of the agents with queued or running tasks, per case. */
  agents: Map<string, string[]>;
};

export type WaitingForInput = {
  status: OrchestratorCaseStatus;
  turnRunning: boolean;
  pendingDecisionCount: number;
  activeTaskCount: number;
  hasOpenWait: boolean;
  hasWaitingConversation: boolean;
};

export async function loadOrgCaseRows(
  organizationId: string,
  query: OrchestratorCaseListQuery
) {
  return await withDb((db) =>
    db.orchestratorCase.findMany({
      where: {
        organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: ORG_CASES_MAX,
      select: {
        id: true,
        projectId: true,
        workflowId: true,
        title: true,
        sourceKey: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        project: { select: { id: true, name: true } },
        workflow: { select: { id: true, name: true } },
        _count: {
          select: {
            conversations: true,
            decisions: {
              where: { status: OrchestratorDecisionStatus.Pending },
            },
            tasks: {
              where: {
                status: {
                  in: [
                    OrchestratorTaskStatus.Queued,
                    OrchestratorTaskStatus.Running,
                  ],
                },
              },
            },
          },
        },
      },
    })
  );
}

export async function loadCaseWaitState(
  organizationId: string,
  caseIds: string[]
): Promise<CaseWaitState> {
  const state: CaseWaitState = {
    waitingConversation: new Set(),
    openWait: new Set(),
    agents: new Map(),
  };
  if (caseIds.length === 0) {
    return state;
  }
  const [conversations, waits, tasks] = await Promise.all([
    withDb((db) =>
      db.orchestratorConversation.findMany({
        where: {
          caseId: { in: caseIds },
          status: OrchestratorConversationStatus.Waiting,
        },
        select: { caseId: true },
      })
    ),
    withDb((db) =>
      db.orchestratorWait.findMany({
        where: {
          organizationId,
          firedAt: null,
          conversation: { caseId: { in: caseIds } },
        },
        select: { conversation: { select: { caseId: true } } },
      })
    ),
    withDb((db) =>
      db.orchestratorTask.findMany({
        where: {
          organizationId,
          caseId: { in: caseIds },
          status: {
            in: [OrchestratorTaskStatus.Queued, OrchestratorTaskStatus.Running],
          },
        },
        select: {
          caseId: true,
          computeTarget: { select: { machineName: true } },
        },
      })
    ),
  ]);
  for (const row of conversations) {
    state.waitingConversation.add(row.caseId);
  }
  for (const row of waits) {
    state.openWait.add(row.conversation.caseId);
  }
  const names = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (task.computeTarget) {
      const set = names.get(task.caseId) ?? new Set<string>();
      set.add(task.computeTarget.machineName);
      names.set(task.caseId, set);
    }
  }
  for (const [caseId, set] of names) {
    state.agents.set(caseId, [...set].sort());
  }
  return state;
}

export function deriveCaseWaitingFor(
  input: WaitingForInput
): OrchestratorCaseWaitingFor {
  if (input.status === OrchestratorCaseStatus.Closed) {
    return OrchestratorCaseWaitingFor.Nothing;
  }
  if (input.turnRunning) {
    return OrchestratorCaseWaitingFor.Turn;
  }
  if (input.pendingDecisionCount > 0) {
    return OrchestratorCaseWaitingFor.Decision;
  }
  if (input.hasOpenWait || input.activeTaskCount > 0) {
    return OrchestratorCaseWaitingFor.Tasks;
  }
  if (input.hasWaitingConversation) {
    return OrchestratorCaseWaitingFor.Human;
  }
  return OrchestratorCaseWaitingFor.NextMessage;
}

export function toCaseListItem(
  summary: OrchestratorCaseSummary,
  row: {
    project: { id: string; name: string };
    workflow: { id: string; name: string };
  },
  waitingFor: OrchestratorCaseWaitingFor,
  runningAgents: string[]
): OrchestratorCaseListItem {
  return {
    ...summary,
    project: row.project,
    workflow: row.workflow,
    waitingFor,
    runningAgents,
  };
}
