import { OrchestratorCaseStatus } from "@repo/api/src/types/orchestrator";
import type { WorkflowCaseCounts } from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";

import { caseNeedsPersonWhere } from "@/lib/orchestrator/case-needs-person";

/**
 * Case counts of orchestrated workflows (they have no workflow runs): one
 * grouped query for all asked workflows.
 */

export type CaseCountsByWorkflow = Map<string, WorkflowCaseCounts>;

export type CaseGroup = {
  status: string;
  _count: { _all: number };
  _max: { updatedAt: Date | null };
};

export async function loadCaseCounts(
  organizationId: string,
  workflowIds: string[]
): Promise<CaseCountsByWorkflow> {
  const counts: CaseCountsByWorkflow = new Map();
  if (workflowIds.length === 0) {
    return counts;
  }
  const [groups, needsPersonGroups] = await withDb((db) =>
    Promise.all([
      db.orchestratorCase.groupBy({
        by: ["workflowId", "status"],
        where: { organizationId, workflowId: { in: workflowIds } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      db.orchestratorCase.groupBy({
        by: ["workflowId"],
        where: {
          AND: [
            { organizationId, workflowId: { in: workflowIds } },
            caseNeedsPersonWhere(),
          ],
        },
        _count: { _all: true },
      }),
    ])
  );
  for (const id of workflowIds) {
    counts.set(id, emptyCaseCounts());
  }
  for (const group of groups) {
    const current = counts.get(group.workflowId) ?? emptyCaseCounts();
    counts.set(group.workflowId, addCaseGroup(current, group));
  }
  for (const group of needsPersonGroups) {
    const current = counts.get(group.workflowId) ?? emptyCaseCounts();
    counts.set(group.workflowId, {
      ...current,
      needsPerson: group._count._all,
    });
  }
  return counts;
}

export function addCaseGroup(
  counts: WorkflowCaseCounts,
  group: CaseGroup
): WorkflowCaseCounts {
  const amount = group._count._all;
  const isClosed = group.status === OrchestratorCaseStatus.Closed;
  return {
    total: counts.total + amount,
    open: counts.open + (isClosed ? 0 : amount),
    closed: counts.closed + (isClosed ? amount : 0),
    lastActivityAt: laterDate(counts.lastActivityAt, group._max.updatedAt),
    needsPerson: counts.needsPerson,
  };
}

function emptyCaseCounts(): WorkflowCaseCounts {
  return { total: 0, open: 0, closed: 0, lastActivityAt: null, needsPerson: 0 };
}

function laterDate(a: Date | null, b: Date | null): Date | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return a.getTime() >= b.getTime() ? a : b;
}
