import {
  ORCHESTRATOR_TASK_BLOCKED_PREFIX,
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import type {
  OrgCaseStats,
  OrgCaseTimeStats,
} from "@repo/api/src/types/org-stats";
import { withDb } from "@repo/database";
import { loadCaseStats } from "@/app/orchestrator/cases/service/case-stats";

/**
 * Case counts and times for the Home widgets. Case time is active agent time
 * (sessions and turns); elapsed time (`createdAt` to `closedAt`) is secondary.
 */

const DAY_MS = 86_400_000;
const CLOSED_ROWS_MAX = 1000;

export type ClosedCaseTimeRow = {
  createdAt: Date;
  closedAt: Date | null;
  activeMs: number;
};

export const orgCaseStatsService = {
  async get(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgCaseStats> {
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const [
      open,
      waitingForHuman,
      withBlockedOrFailedTasks,
      closed7d,
      closed30d,
      closedRows,
    ] = await Promise.all([
      withDb((db) =>
        db.orchestratorCase.count({
          where: { organizationId, status: OrchestratorCaseStatus.Open },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.count({
          where: {
            organizationId,
            status: OrchestratorCaseStatus.Open,
            OR: [
              {
                decisions: {
                  some: { status: OrchestratorDecisionStatus.Pending },
                },
              },
              {
                conversations: {
                  some: {
                    status: OrchestratorConversationStatus.Waiting,
                    waits: { none: { firedAt: null } },
                  },
                },
              },
            ],
          },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.count({
          where: {
            organizationId,
            status: OrchestratorCaseStatus.Open,
            tasks: { some: blockedOrFailedTaskWhere(since7) },
          },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.count({
          where: {
            organizationId,
            status: OrchestratorCaseStatus.Closed,
            closedAt: { gte: since7 },
          },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.count({
          where: {
            organizationId,
            status: OrchestratorCaseStatus.Closed,
            closedAt: { gte: since30 },
          },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.findMany({
          where: {
            organizationId,
            status: OrchestratorCaseStatus.Closed,
            closedAt: { gte: since30 },
          },
          orderBy: { closedAt: "desc" },
          take: CLOSED_ROWS_MAX,
          select: { id: true, createdAt: true, closedAt: true },
        })
      ),
    ]);
    const stats = await loadCaseStats(
      organizationId,
      closedRows.map((row) => row.id),
      now
    );
    const timed: ClosedCaseTimeRow[] = closedRows.map((row) => ({
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      activeMs: stats.get(row.id)?.activeMs ?? 0,
    }));
    return {
      open,
      waitingForHuman,
      withBlockedOrFailedTasks,
      closed7d,
      closed30d,
      time7d: caseTimeStats(
        timed.filter((row) => row.closedAt !== null && row.closedAt >= since7)
      ),
      time30d: caseTimeStats(timed),
    };
  },
};

/** Failed tasks and BLOCKED ones (succeeded with a `BLOCKED:` reply) since a date. */
export function blockedOrFailedTaskWhere(since: Date) {
  return {
    finishedAt: { gte: since },
    OR: [
      { status: OrchestratorTaskStatus.Failed },
      {
        status: OrchestratorTaskStatus.Succeeded,
        result: {
          path: ["reply"],
          string_starts_with: ORCHESTRATOR_TASK_BLOCKED_PREFIX,
        },
      },
    ],
  };
}

export function median(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function caseTimeStats(rows: ClosedCaseTimeRow[]): OrgCaseTimeStats {
  const closed = rows.filter((row) => row.closedAt !== null);
  return {
    sampleSize: closed.length,
    medianActiveMs: median(closed.map((row) => row.activeMs)),
    totalActiveMs: closed.reduce((sum, row) => sum + row.activeMs, 0),
    medianElapsedMs: median(
      closed.map(
        (row) => (row.closedAt as Date).getTime() - row.createdAt.getTime()
      )
    ),
  };
}
