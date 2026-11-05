import {
  ORCHESTRATOR_TASK_BLOCKED_PREFIX,
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorMessageKind,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import {
  ORG_ATTENTION_MAX_ITEMS,
  type OrgAttentionItem,
  OrgAttentionKind,
  type OrgAttentionStats,
} from "@repo/api/src/types/org-stats";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";
import { computeTargetFleetService } from "@/app/compute-targets/fleet-service";
import { blockedOrFailedTaskWhere } from "@/app/org-stats/case-stats-service";

/**
 * "Needs attention" list and 7-day rates for Home. No user scoping: every org
 * member sees the same list.
 */

const DAY_MS = 86_400_000;
const PER_SOURCE_MAX = 5;
const DECISION_DETAIL_MAX = 160;

const CASE_SELECT = {
  id: true,
  title: true,
  project: { select: { name: true } },
  workflow: { select: { name: true } },
} as const;

type CaseRef = {
  id: string;
  title: string;
  project: { name: string } | null;
  workflow: { name: string } | null;
};

export const attentionStatsService = {
  async get(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgAttentionStats> {
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const openCase = { status: OrchestratorCaseStatus.Open };
    const [
      waiting,
      decisions,
      tasks,
      fleet,
      taskGroups,
      blocked,
      failedRuns7d,
      guardRefusals7d,
    ] = await Promise.all([
      withDb((db) =>
        db.orchestratorConversation.findMany({
          where: {
            organizationId,
            status: OrchestratorConversationStatus.Waiting,
            waits: { none: { firedAt: null } },
            case: openCase,
          },
          orderBy: { updatedAt: "asc" },
          take: PER_SOURCE_MAX,
          select: { updatedAt: true, case: { select: CASE_SELECT } },
        })
      ),
      withDb((db) =>
        db.orchestratorDecision.findMany({
          where: {
            organizationId,
            status: OrchestratorDecisionStatus.Pending,
            case: openCase,
          },
          orderBy: { createdAt: "asc" },
          take: PER_SOURCE_MAX,
          select: {
            question: true,
            createdAt: true,
            case: { select: CASE_SELECT },
          },
        })
      ),
      withDb((db) =>
        db.orchestratorTask.findMany({
          where: {
            organizationId,
            case: openCase,
            ...blockedOrFailedTaskWhere(since7),
          },
          orderBy: { finishedAt: "desc" },
          take: PER_SOURCE_MAX,
          select: {
            status: true,
            command: true,
            finishedAt: true,
            case: { select: CASE_SELECT },
          },
        })
      ),
      computeTargetFleetService.list(organizationId),
      withDb((db) =>
        db.orchestratorTask.groupBy({
          by: ["status"],
          where: {
            organizationId,
            finishedAt: { gte: since7 },
            status: {
              in: [
                OrchestratorTaskStatus.Succeeded,
                OrchestratorTaskStatus.Failed,
              ],
            },
          },
          _count: { _all: true },
        })
      ),
      withDb((db) =>
        db.orchestratorTask.count({
          where: {
            organizationId,
            finishedAt: { gte: since7 },
            status: OrchestratorTaskStatus.Succeeded,
            result: {
              path: ["reply"],
              string_starts_with: ORCHESTRATOR_TASK_BLOCKED_PREFIX,
            },
          },
        })
      ),
      withDb((db) =>
        db.workflowRun.count({
          where: {
            organizationId,
            status: WorkflowRunStatus.Failed,
            updatedAt: { gte: since7 },
          },
        })
      ),
      withDb((db) =>
        db.orchestratorMessage.count({
          where: {
            organizationId,
            kind: OrchestratorMessageKind.ToolRefused,
            createdAt: { gte: since7 },
          },
        })
      ),
    ]);

    const offline = fleet.agents.filter(
      (agent) => !agent.isOnline && agent.enabledWorkflowCount > 0
    );
    const items = mergeAttentionItems(
      [
        waiting.map((row) =>
          caseItem(
            OrgAttentionKind.WaitingForHuman,
            row.case,
            null,
            row.updatedAt
          )
        ),
        decisions.map((row) =>
          caseItem(
            OrgAttentionKind.PendingDecision,
            row.case,
            row.question.slice(0, DECISION_DETAIL_MAX),
            row.createdAt
          )
        ),
        tasks.map((row) =>
          caseItem(
            row.status === OrchestratorTaskStatus.Failed
              ? OrgAttentionKind.FailedTask
              : OrgAttentionKind.BlockedTask,
            row.case,
            row.command,
            row.finishedAt ?? now
          )
        ),
        offline.map((agent) => ({
          kind: OrgAttentionKind.OfflineAgent,
          title: agent.displayName ?? agent.machineName,
          detail: null,
          caseId: null,
          computeTargetId: agent.id,
          projectName: null,
          workflowName: null,
          since: agent.lastSeen,
        })),
      ],
      ORG_ATTENTION_MAX_ITEMS
    );

    const failed =
      taskGroups.find((g) => g.status === OrchestratorTaskStatus.Failed)?._count
        ._all ?? 0;
    const succeededAll =
      taskGroups.find((g) => g.status === OrchestratorTaskStatus.Succeeded)
        ?._count._all ?? 0;
    return {
      items,
      tasks7d: {
        succeeded: Math.max(0, succeededAll - blocked),
        failed,
        blocked,
      },
      failedRuns7d,
      guardRefusals7d,
    };
  },
};

/** Merges per-source lists, oldest first, capped at `max`. */
export function mergeAttentionItems(
  lists: OrgAttentionItem[][],
  max: number
): OrgAttentionItem[] {
  return lists
    .flat()
    .sort((a, b) => a.since.localeCompare(b.since))
    .slice(0, max);
}

function caseItem(
  kind: OrgAttentionKind,
  caseRef: CaseRef,
  detail: string | null,
  since: Date
): OrgAttentionItem {
  return {
    kind,
    title: caseRef.title,
    detail,
    caseId: caseRef.id,
    computeTargetId: null,
    projectName: caseRef.project?.name ?? null,
    workflowName: caseRef.workflow?.name ?? null,
    since: since.toISOString(),
  };
}
