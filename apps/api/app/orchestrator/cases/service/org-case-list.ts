import {
  type OrchestratorCaseAgent,
  type OrchestratorCaseListItem,
  type OrchestratorCaseListQuery,
  OrchestratorCaseStatus,
  type OrchestratorCaseSummary,
  OrchestratorCaseWaitingFor,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { type Prisma, withDb } from "@repo/database";
import { caseNeedsPersonWhere } from "@/lib/orchestrator/case-needs-person";

/**
 * Org-wide case list reads: every case that needs a person (up to the cap)
 * followed by the most recently updated cases and, for them, what each is
 * waiting for. One query per table, no per-case fan-out.
 */

const ORG_CASES_MAX = 100;

export type CaseWaitState = {
  waitingConversation: Set<string>;
  openWait: Set<string>;
  /** Cases whose next turn is already due (a scheduled wake has passed). */
  wakeDue: Set<string>;
  /** The newest wait_human asked per case. */
  askedHuman: Map<string, string>;
  /** Machine names of the agents with queued or running tasks, per case. */
  agents: Map<string, string[]>;
  /** Every agent with a task in the case. */
  caseAgents: Map<string, OrchestratorCaseAgent[]>;
};

export type CaseAgentGroup = {
  caseId: string;
  computeTargetId: string | null;
  status: string;
  _count: { _all: number };
  _sum: { openQuestionCount: number | null };
};

export type WaitingForInput = {
  status: OrchestratorCaseStatus;
  turnRunning: boolean;
  pendingDecisionCount: number;
  activeTaskCount: number;
  hasOpenWait: boolean;
  needsPerson: boolean;
  wakeDue: boolean;
};

export async function loadOrgCaseRows(
  organizationId: string,
  query: OrchestratorCaseListQuery
) {
  const base: Prisma.OrchestratorCaseWhereInput = {
    organizationId,
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.workflowId ? { workflowId: query.workflowId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [needsPersonRows, recentRows] = await withDb((db) =>
    Promise.all([
      db.orchestratorCase.findMany({
        where: { AND: [base, caseNeedsPersonWhere()] },
        orderBy: { updatedAt: "desc" },
        take: ORG_CASES_MAX,
        select: CASE_ROW_SELECT,
      }),
      db.orchestratorCase.findMany({
        where: base,
        orderBy: { updatedAt: "desc" },
        take: ORG_CASES_MAX,
        select: CASE_ROW_SELECT,
      }),
    ])
  );
  const needsPerson = new Set(needsPersonRows.map((row) => row.id));
  const rows = [
    ...needsPersonRows,
    ...recentRows.filter((row) => !needsPerson.has(row.id)),
  ];
  return { rows, needsPerson };
}

export async function loadCaseWaitState(
  organizationId: string,
  caseIds: string[],
  now: Date
): Promise<CaseWaitState> {
  const state: CaseWaitState = {
    waitingConversation: new Set(),
    openWait: new Set(),
    wakeDue: new Set(),
    askedHuman: new Map(),
    agents: new Map(),
    caseAgents: new Map(),
  };
  if (caseIds.length === 0) {
    return state;
  }
  const [conversations, waits, tasks, agentGroups] = await Promise.all([
    withDb((db) =>
      db.orchestratorConversation.findMany({
        where: {
          organizationId,
          caseId: { in: caseIds },
          OR: [
            { status: OrchestratorConversationStatus.Waiting },
            { askedHuman: { not: null } },
            { nextWakeAt: { not: null } },
          ],
        },
        select: {
          caseId: true,
          status: true,
          askedHuman: true,
          nextWakeAt: true,
        },
        orderBy: { updatedAt: "desc" },
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
    withDb((db) =>
      db.orchestratorTask.groupBy({
        by: ["caseId", "computeTargetId", "status"],
        where: {
          organizationId,
          caseId: { in: caseIds },
          computeTargetId: { not: null },
        },
        _count: { _all: true },
        _sum: { openQuestionCount: true },
      })
    ),
  ]);
  for (const row of conversations) {
    foldConversation(state, row, now);
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
  state.caseAgents = foldCaseAgents(agentGroups);
  return state;
}

/** Every agent with a task in each case, sorted by compute target id. */
export function foldCaseAgents(
  groups: CaseAgentGroup[]
): Map<string, OrchestratorCaseAgent[]> {
  const byCase = new Map<string, Map<string, OrchestratorCaseAgent>>();
  for (const group of groups) {
    if (!group.computeTargetId) {
      continue;
    }
    const agents = byCase.get(group.caseId) ?? new Map();
    const agent: OrchestratorCaseAgent = agents.get(group.computeTargetId) ?? {
      computeTargetId: group.computeTargetId,
      activeTaskCount: 0,
      openQuestionCount: 0,
    };
    if (isActiveTaskStatus(group.status)) {
      agent.activeTaskCount += group._count._all;
    }
    agent.openQuestionCount += group._sum.openQuestionCount ?? 0;
    agents.set(group.computeTargetId, agent);
    byCase.set(group.caseId, agents);
  }
  const folded = new Map<string, OrchestratorCaseAgent[]>();
  for (const [caseId, agents] of byCase) {
    folded.set(
      caseId,
      [...agents.values()].sort((a, b) =>
        a.computeTargetId.localeCompare(b.computeTargetId)
      )
    );
  }
  return folded;
}

export function deriveCaseWaitingFor(
  input: WaitingForInput
): OrchestratorCaseWaitingFor {
  if (input.status === OrchestratorCaseStatus.Closed) {
    return OrchestratorCaseWaitingFor.Nothing;
  }
  if (input.turnRunning || input.wakeDue) {
    return OrchestratorCaseWaitingFor.Turn;
  }
  if (input.pendingDecisionCount > 0) {
    return OrchestratorCaseWaitingFor.Decision;
  }
  if (input.hasOpenWait || input.activeTaskCount > 0) {
    return OrchestratorCaseWaitingFor.Tasks;
  }
  if (input.needsPerson) {
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
  extras: {
    waitingFor: OrchestratorCaseWaitingFor;
    runningAgents: string[];
    needsPerson: boolean;
    askedHuman: string | null;
    agents: OrchestratorCaseAgent[];
  }
): OrchestratorCaseListItem {
  return {
    ...summary,
    project: row.project,
    workflow: row.workflow,
    ...extras,
  };
}

const CASE_ROW_SELECT = {
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
            in: [OrchestratorTaskStatus.Queued, OrchestratorTaskStatus.Running],
          },
        },
      },
    },
  },
} satisfies Prisma.OrchestratorCaseSelect;

function isActiveTaskStatus(status: string): boolean {
  return (
    status === OrchestratorTaskStatus.Queued ||
    status === OrchestratorTaskStatus.Running
  );
}

/** Folds one conversation row (newest first) into the case's wait state. */
function foldConversation(
  state: CaseWaitState,
  row: {
    caseId: string;
    status: string;
    askedHuman: string | null;
    nextWakeAt: Date | null;
  },
  now: Date
): void {
  if (row.status === OrchestratorConversationStatus.Waiting) {
    state.waitingConversation.add(row.caseId);
  }
  if (row.askedHuman && !state.askedHuman.has(row.caseId)) {
    state.askedHuman.set(row.caseId, row.askedHuman);
  }
  if (row.nextWakeAt && row.nextWakeAt.getTime() <= now.getTime()) {
    state.wakeDue.add(row.caseId);
  }
}
