import { withDb } from "@repo/database";
import type { UsageTotals } from "@/lib/usage/loop-usage";
import {
  addUsage,
  emptyUsage,
  loadLoopUsage,
  turnUsage,
} from "@/lib/usage/loop-usage";

/**
 * Per-case task and turn counts, tokens, cost and active agent time for the
 * case list and page: bounded queries for all asked cases, no per-case
 * fan-out. A task's session numbers win over its loop's, and turns are added.
 */

export type CaseStats = {
  taskCount: number;
  turnCount: number;
} & UsageTotals;

type TurnRow = {
  usage: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  conversation: { caseId: string };
};
type TaskRow = { caseId: string; loopId: string | null };

export async function loadCaseStats(
  organizationId: string,
  caseIds: string[],
  now: Date = new Date()
): Promise<Map<string, CaseStats>> {
  if (caseIds.length === 0) {
    return new Map();
  }
  const [turns, tasks] = await Promise.all([
    withDb((db) =>
      db.orchestratorTurn.findMany({
        where: { organizationId, conversation: { caseId: { in: caseIds } } },
        select: {
          usage: true,
          startedAt: true,
          finishedAt: true,
          conversation: { select: { caseId: true } },
        },
      })
    ),
    withDb((db) =>
      db.orchestratorTask.findMany({
        where: { organizationId, caseId: { in: caseIds } },
        select: { caseId: true, loopId: true },
      })
    ),
  ]);
  const loopIds = [
    ...new Set(
      tasks.flatMap((task) => (task.loopId === null ? [] : [task.loopId]))
    ),
  ];
  const loopUsageById = await loadLoopUsage(organizationId, loopIds, now);
  return foldCaseStats(caseIds, turns, tasks, loopUsageById, now);
}

export function foldCaseStats(
  caseIds: string[],
  turns: TurnRow[],
  tasks: TaskRow[],
  loopUsageById: Map<string, UsageTotals>,
  now: Date = new Date()
): Map<string, CaseStats> {
  const stats = new Map<string, CaseStats>();
  for (const id of caseIds) {
    stats.set(id, { taskCount: 0, turnCount: 0, ...emptyUsage() });
  }
  for (const turn of turns) {
    const current = stats.get(turn.conversation.caseId);
    if (current) {
      stats.set(turn.conversation.caseId, {
        ...current,
        ...addUsage(current, turnUsage(turn, now)),
        turnCount: current.turnCount + 1,
      });
    }
  }
  for (const task of tasks) {
    const current = stats.get(task.caseId);
    if (current) {
      const loopUsage =
        task.loopId === null ? undefined : loopUsageById.get(task.loopId);
      stats.set(task.caseId, {
        ...current,
        ...(loopUsage ? addUsage(current, loopUsage) : {}),
        taskCount: current.taskCount + 1,
      });
    }
  }
  return stats;
}
