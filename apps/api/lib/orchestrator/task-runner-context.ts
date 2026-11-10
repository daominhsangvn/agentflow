import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import {
  capacityOf,
  countActiveLoopsByTarget,
} from "@/app/projects/project-runner-selection";
import type { CaseRunnerContext, RunnerLoad } from "./task-runner-match";

/**
 * The data `pickCaseTaskRunner` decides with: the Agents of the case's started or queued tasks
 * (latest first) and, when several Agents are candidates, each one's load (active loops, queued tasks,
 * capacity). Three bounded queries, not one per candidate.
 */
export async function loadCaseRunnerContext(input: {
  organizationId: string;
  caseId: string;
  candidateIds: string[];
  /** The Agent of the task being resumed: it comes first, so it wins over the case's latest. */
  pinnedTargetId?: string | null;
}): Promise<CaseRunnerContext> {
  const { organizationId, caseId, candidateIds, pinnedTargetId } = input;
  const started = await withDb((db) =>
    db.orchestratorTask.findMany({
      where: {
        organizationId,
        caseId,
        computeTargetId: { not: null },
        // Started tasks, and queued ones waiting for a busy Agent (no loop yet): both hold the
        // case's Agent for the role.
        OR: [
          { loopId: { not: null } },
          { status: OrchestratorTaskStatus.Queued },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { computeTargetId: true },
    })
  );
  const startedTargetIds = [
    ...(pinnedTargetId ? [pinnedTargetId] : []),
    ...started.flatMap((row) =>
      row.computeTargetId ? [row.computeTargetId] : []
    ),
  ];
  if (candidateIds.length <= 1) {
    return { startedTargetIds, loads: new Map() };
  }
  const [active, queuedGroups, targets] = await Promise.all([
    countActiveLoopsByTarget(organizationId, candidateIds),
    withDb((db) =>
      db.orchestratorTask.groupBy({
        by: ["computeTargetId"],
        where: {
          organizationId,
          computeTargetId: { in: candidateIds },
          status: OrchestratorTaskStatus.Queued,
        },
        _count: { _all: true },
      })
    ),
    withDb((db) =>
      db.computeTarget.findMany({
        where: { id: { in: candidateIds }, organizationId },
        select: { id: true, capabilities: true },
      })
    ),
  ]);
  const queued = new Map(
    queuedGroups.flatMap((group) =>
      group.computeTargetId
        ? [[group.computeTargetId, group._count._all] as const]
        : []
    )
  );
  const loads = new Map<string, RunnerLoad>(
    targets.map((target) => [
      target.id,
      {
        active: active.get(target.id) ?? 0,
        queued: queued.get(target.id) ?? 0,
        capacity: capacityOf(target.capabilities),
      },
    ])
  );
  return { startedTargetIds, loads };
}
