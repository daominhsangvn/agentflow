import {
  type OrchestratorCaseDetail,
  type OrchestratorCaseListItem,
  type OrchestratorCaseListQuery,
  type OrchestratorCaseLoops,
  OrchestratorCaseStatus,
  type OrchestratorCaseSummary,
  OrchestratorDecisionStatus,
  OrchestratorTaskStatus,
  OrchestratorTurnStatus,
  type UpdateOrchestratorCaseInput,
} from "@repo/api/src/types/orchestrator";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import {
  toCaseDetail,
  toCaseSummary,
} from "@/app/orchestrator/cases/case-mappers";
import { loadWorkflowAgentMap } from "@/app/orchestrator/cases/service/agent-map";
import { loadCaseLoops } from "@/app/orchestrator/cases/service/case-loops";
import { postCaseMessage } from "@/app/orchestrator/cases/service/case-messages";
import {
  type CaseStats,
  loadCaseStats,
} from "@/app/orchestrator/cases/service/case-stats";
import {
  deriveCaseWaitingFor,
  loadCaseWaitState,
  loadOrgCaseRows,
  toCaseListItem,
} from "@/app/orchestrator/cases/service/org-case-list";
import { readCaseTaskFile } from "@/app/orchestrator/cases/service/task-file";
import { dispatchOrchestratorTurnCancel } from "@/lib/loops/loop-desktop";
import { listCaseDocuments } from "@/lib/orchestrator/case-documents";
import { readTurnTimeoutMs } from "@/lib/orchestrator/turn-usage";
import { displayUserName } from "@/lib/user-display-name";

/**
 * What the case pages read and the admin actions on them
 * (docs/orchestrator.md). Reads are bounded: the 100 most recently updated
 * cases of a workflow; per case the newest messages, turns, tasks, waits and
 * decisions.
 */

const CASES_MAX = 100;
const MESSAGES_MAX = 200;
const TURNS_MAX = 100;
const TASKS_MAX = 200;
const WAITS_MAX = 100;
const DECISIONS_MAX = 100;

export const orchestratorCaseService = {
  agentMapForWorkflow: loadWorkflowAgentMap,

  postMessage: postCaseMessage,

  /** Null when the file is not a stored file of a task of this organization's case. */
  readTaskFile: readCaseTaskFile,

  /** Null when the organization has no such workflow. */
  async listForWorkflow(
    organizationId: string,
    workflowId: string
  ): Promise<OrchestratorCaseSummary[] | null> {
    const workflow = await withDb((db) =>
      db.workflow.findFirst({
        where: { id: workflowId, organizationId },
        select: { id: true },
      })
    );
    if (!workflow) {
      return null;
    }
    const rows = await withDb((db) =>
      db.orchestratorCase.findMany({
        where: { organizationId, workflowId },
        orderBy: { updatedAt: "desc" },
        take: CASES_MAX,
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
    const ids = rows.map((row) => row.id);
    const [running, stats] = await Promise.all([
      runningCaseIds(organizationId, ids),
      loadCaseStats(organizationId, ids),
    ]);
    return rows.map((row) =>
      toCaseSummary(row, running.has(row.id), stats.get(row.id) ?? EMPTY_STATS)
    );
  },

  /** Every needs-a-person case (up to 100), then the 100 most recently updated. */
  async listForOrg(
    organizationId: string,
    query: OrchestratorCaseListQuery
  ): Promise<OrchestratorCaseListItem[]> {
    const { rows, needsPerson } = await loadOrgCaseRows(organizationId, query);
    const ids = rows.map((row) => row.id);
    const [running, stats, waitState] = await Promise.all([
      runningCaseIds(organizationId, ids),
      loadCaseStats(organizationId, ids),
      loadCaseWaitState(organizationId, ids, new Date()),
    ]);
    return rows.map((row) => {
      const turnRunning = running.has(row.id);
      const summary = toCaseSummary(
        row,
        turnRunning,
        stats.get(row.id) ?? EMPTY_STATS
      );
      const needsAPerson = needsPerson.has(row.id);
      const waitingFor = deriveCaseWaitingFor({
        status: summary.status,
        turnRunning,
        pendingDecisionCount: summary.pendingDecisionCount,
        activeTaskCount: summary.activeTaskCount,
        hasOpenWait: waitState.openWait.has(row.id),
        needsPerson: needsAPerson,
        wakeDue: waitState.wakeDue.has(row.id),
      });
      return toCaseListItem(summary, row, {
        waitingFor,
        runningAgents: waitState.agents.get(row.id) ?? [],
        needsPerson: needsAPerson,
        askedHuman: waitState.askedHuman.get(row.id) ?? null,
        agents: waitState.caseAgents.get(row.id) ?? [],
      });
    });
  },

  async get(
    organizationId: string,
    caseId: string
  ): Promise<OrchestratorCaseDetail | null> {
    const row = await withDb((db) =>
      db.orchestratorCase.findFirst({
        where: { id: caseId, organizationId },
        include: {
          project: { select: { id: true, name: true } },
          workflow: { select: { id: true, name: true } },
          conversations: {
            orderBy: { createdAt: "asc" },
            include: {
              messages: { orderBy: { createdAt: "desc" }, take: MESSAGES_MAX },
              turns: {
                orderBy: { startedAt: "desc" },
                take: TURNS_MAX,
                include: { computeTarget: { select: { machineName: true } } },
              },
              waits: { orderBy: { createdAt: "desc" }, take: WAITS_MAX },
            },
          },
          tasks: {
            orderBy: { createdAt: "desc" },
            take: TASKS_MAX,
            include: { computeTarget: { select: { machineName: true } } },
          },
          decisions: { orderBy: { createdAt: "desc" }, take: DECISIONS_MAX },
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
    if (!row) {
      return null;
    }
    const [running, stats, documents] = await Promise.all([
      runningCaseIds(organizationId, [row.id]),
      loadCaseStats(organizationId, [row.id]),
      listCaseDocuments(organizationId, row.id),
    ]);
    return toCaseDetail(
      row,
      running.has(row.id),
      stats.get(row.id) ?? EMPTY_STATS,
      documents
    );
  },

  /** Null when the organization has no such case. */
  async getLoops(
    organizationId: string,
    caseId: string
  ): Promise<OrchestratorCaseLoops | null> {
    const found = await withDb((db) =>
      db.orchestratorCase.findFirst({
        where: { id: caseId, organizationId },
        select: { id: true },
      })
    );
    if (!found) {
      return null;
    }
    return loadCaseLoops(organizationId, caseId);
  },

  /** Close or reopen a case. Only the status changes. */
  async setStatus(
    organizationId: string,
    caseId: string,
    input: UpdateOrchestratorCaseInput
  ): Promise<
    Result<{ status: UpdateOrchestratorCaseInput["status"] }, StatusCode>
  > {
    const updated = await withDb((db) =>
      db.orchestratorCase.updateMany({
        where: { id: caseId, organizationId },
        data: {
          status: input.status,
          closedAt:
            input.status === OrchestratorCaseStatus.Closed ? new Date() : null,
        },
      })
    );
    if (updated.count === 0) {
      return Result.err(Status.NotFound);
    }
    return Result.ok({ status: input.status });
  },

  /**
   * Deletes a case and, by cascade, its conversations, messages, turns, tasks,
   * waits and decisions. Refused (Conflict) while a turn runs or a task is
   * queued or running; NotFound when the org has no such case.
   */
  async remove(
    organizationId: string,
    caseId: string
  ): Promise<Result<{ caseId: string }, StatusCode>> {
    const deleted = await withDb((db) =>
      db.orchestratorCase.deleteMany({
        where: {
          id: caseId,
          organizationId,
          tasks: {
            none: {
              status: {
                in: [
                  OrchestratorTaskStatus.Queued,
                  OrchestratorTaskStatus.Running,
                ],
              },
            },
          },
          conversations: {
            none: {
              turns: { some: { status: OrchestratorTurnStatus.Running } },
            },
          },
        },
      })
    );
    if (deleted.count > 0) {
      return Result.ok({ caseId });
    }
    const exists = await withDb((db) =>
      db.orchestratorCase.findFirst({
        where: { id: caseId, organizationId },
        select: { id: true },
      })
    );
    return Result.err(exists ? Status.Conflict : Status.NotFound);
  },

  /**
   * Stops a running turn: marks it (so it settles as failed, "Stopped by
   * <admin>.", without a retry) and asks its runner to stop it.
   */
  async cancelTurn(
    organizationId: string,
    userId: string,
    turnId: string
  ): Promise<Result<{ turnId: string }, StatusCode>> {
    const turn = await withDb((db) =>
      db.orchestratorTurn.findFirst({
        where: {
          id: turnId,
          organizationId,
          status: OrchestratorTurnStatus.Running,
        },
        select: { id: true, computeTargetId: true, usage: true },
      })
    );
    if (!turn) {
      return Result.err(Status.NotFound);
    }
    if (!turn.computeTargetId) {
      return Result.err(Status.BadRequest);
    }
    const user = await withDb((db) =>
      db.user.findFirst({
        where: { id: userId, organizationId },
        select: { firstName: true, lastName: true, email: true },
      })
    );
    if (!user) {
      return Result.err(Status.Forbidden);
    }
    // Conditional on still running: a turn that settled meanwhile keeps its
    // real usage and is not cancelled.
    const marked = await withDb((db) =>
      db.orchestratorTurn.updateMany({
        where: {
          id: turn.id,
          organizationId,
          status: OrchestratorTurnStatus.Running,
        },
        data: {
          usage: {
            timeoutMs: readTurnTimeoutMs(turn.usage),
            cancelRequestedAt: new Date().toISOString(),
            cancelledBy: displayUserName(user),
          },
        },
      })
    );
    if (marked.count === 0) {
      return Result.err(Status.NotFound);
    }
    try {
      await dispatchOrchestratorTurnCancel({
        computeTargetId: turn.computeTargetId,
        turnId: turn.id,
      });
    } catch {
      return Result.err(Status.BadGateway);
    }
    return Result.ok({ turnId: turn.id });
  },
};

/** The cases (of those asked) with a running turn: one query, no fan-out. */
async function runningCaseIds(
  organizationId: string,
  caseIds: string[]
): Promise<Set<string>> {
  if (caseIds.length === 0) {
    return new Set();
  }
  const turns = await withDb((db) =>
    db.orchestratorTurn.findMany({
      where: {
        organizationId,
        status: OrchestratorTurnStatus.Running,
        conversation: { caseId: { in: caseIds } },
      },
      select: { conversation: { select: { caseId: true } } },
    })
  );
  return new Set(turns.map((turn) => turn.conversation.caseId));
}

const EMPTY_STATS: CaseStats = {
  taskCount: 0,
  turnCount: 0,
  costUsd: null,
  inputTokens: 0,
  outputTokens: 0,
  activeMs: 0,
};
