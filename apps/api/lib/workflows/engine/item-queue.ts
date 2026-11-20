import {
  WORKFLOW_RUN_FINAL_STATUSES,
  WorkflowActionRunStatus,
  WorkflowActionStage,
  WorkflowRunErrorCode,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import { withDb } from "@repo/database";
import { AfAttribute } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { withSpan } from "@repo/observability/span";
import { z } from "zod";
import { runError } from "./errors";
import type { EngineRun, StepOutcome } from "./step-outcome";

/**
 * Item queue (docs/workflows.md "Item queue"): with `agent.sameItem` set to
 * queue or queue_resume, the runs of one item (workflowId, sourceKey) execute
 * one after another. A queued run stays `received` and re-checks through the
 * step retry (`nextStepAt`); it starts only when no other run of the item has
 * started and not finished, it is the first of the item's waiting runs, and
 * the previous run's reply (post actions of its final event) is final.
 */

/** Re-check delay while another run of the item is open. */
export const ITEM_QUEUE_RETRY_MS = 60_000;
/** Re-check delay while the previous run's final-event post actions are open. */
export const ITEM_QUEUE_ACTIONS_RETRY_MS = 15_000;
/** Bound of the wait for the previous run's post actions; past it the next run starts anyway. */
export const ITEM_QUEUE_ACTIONS_WAIT_MS = 15 * 60_000;

/** Other runs of an item that are looked at (bounded query). */
const ITEM_RUNS_LIMIT = 50;

const OPEN_ACTION_STATUSES = [
  WorkflowActionRunStatus.Pending,
  WorkflowActionRunStatus.Running,
  WorkflowActionRunStatus.Waiting,
];

const FINAL_EVENTS = [WorkflowRunEvent.Succeeded, WorkflowRunEvent.Failed];

const sameItemConfigSchema = z.object({
  mode: z.string().optional(),
  sameItem: z.enum(WorkflowSameItem),
});

export type ItemRunKey = {
  id: string;
  organizationId: string;
  workflowId: string;
  sourceKey: string;
  createdAt: Date;
};

type ItemRunSummary = {
  id: string;
  status: WorkflowRunStatus;
  createdAt: Date;
};

/** The item's setting from a run's agent config snapshot; Ignore when absent or orchestrated. */
export function readSameItem(agentConfig: unknown): WorkflowSameItem {
  const parsed = sameItemConfigSchema.safeParse(agentConfig);
  if (!parsed.success || parsed.data.mode === WorkflowAgentMode.Orchestrated) {
    return WorkflowSameItem.Ignore;
  }
  return parsed.data.sameItem;
}

export function loadItemRunKey(
  runId: string,
  organizationId: string
): Promise<ItemRunKey | null> {
  return withDb((db) =>
    db.workflowRun.findUnique({
      where: { id: runId, organizationId },
      select: {
        id: true,
        organizationId: true,
        workflowId: true,
        sourceKey: true,
        createdAt: true,
      },
    })
  );
}

/**
 * The run this one waits for: another run of the item that is past received
 * (rule 1), else the first received run earlier by (createdAt, id) (rule 2).
 */
export async function findItemQueueHolder(
  run: ItemRunKey
): Promise<{ id: string; status: WorkflowRunStatus } | null> {
  const others = await findOpenItemRuns(run);
  return pickQueueHolder(run, others);
}

export function pickQueueHolder(
  run: Pick<ItemRunKey, "id" | "createdAt">,
  others: ItemRunSummary[]
): { id: string; status: WorkflowRunStatus } | null {
  const started = others.find(
    (other) => other.status !== WorkflowRunStatus.Received
  );
  if (started) {
    return { id: started.id, status: started.status };
  }
  const earlier = others.find(
    (other) =>
      other.status === WorkflowRunStatus.Received && isEarlier(other, run)
  );
  return earlier ? { id: earlier.id, status: earlier.status } : null;
}

/** The latest run of the item before this one by (createdAt, id). */
export function findPreviousItemRun(run: ItemRunKey) {
  return withDb((db) =>
    db.workflowRun.findFirst({
      where: {
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        sourceKey: run.sourceKey,
        OR: [
          { createdAt: { lt: run.createdAt } },
          { createdAt: run.createdAt, id: { lt: run.id } },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        cycle: true,
        completedAt: true,
        updatedAt: true,
        source: true,
        featureDocumentId: true,
        planDocumentId: true,
      },
    })
  );
}

/**
 * The received step of a run with the setting: a retry while it must wait,
 * null when it may start (always null, without a query, for ignore).
 */
export async function itemQueueWait(
  run: Pick<EngineRun, "id" | "agentConfig" | "organizationId">,
  now: Date
): Promise<StepOutcome | null> {
  if (readSameItem(run.agentConfig) === WorkflowSameItem.Ignore) {
    return null;
  }
  const key = await loadItemRunKey(run.id, run.organizationId);
  if (!key) {
    return null;
  }
  const holder = await findItemQueueHolder(key);
  if (holder) {
    return {
      kind: "retry",
      delayMs: ITEM_QUEUE_RETRY_MS,
      error: runError(
        WorkflowRunErrorCode.ItemQueued,
        "Waiting for an earlier run of the same item to finish."
      ),
    };
  }
  return await previousReplyWait(run, key, now);
}

/**
 * After a run ended: clears the retry delay of the item's next queued run so
 * it starts at once. Returns its id, or null when none may start.
 */
export function nextQueuedItemRun(
  runId: string,
  organizationId: string
): Promise<string | null> {
  return withSpan(
    "workflow.item_queue_next",
    {
      [AfAttribute.WorkflowRunId]: runId,
      [AfAttribute.OrgId]: organizationId,
    },
    async () => {
      const finished = await withDb((db) =>
        db.workflowRun.findUnique({
          where: { id: runId, organizationId },
          select: {
            id: true,
            organizationId: true,
            workflowId: true,
            sourceKey: true,
            agentConfig: true,
          },
        })
      );
      if (
        !finished ||
        readSameItem(finished.agentConfig) === WorkflowSameItem.Ignore
      ) {
        return null;
      }
      const open = await findOpenItemRuns(finished);
      const first = open[0];
      if (
        !first ||
        first.status !== WorkflowRunStatus.Received ||
        open.some((other) => other.status !== WorkflowRunStatus.Received)
      ) {
        return null;
      }
      await withDb((db) =>
        db.workflowRun.updateMany({
          where: {
            id: first.id,
            organizationId,
            status: WorkflowRunStatus.Received,
          },
          data: { nextStepAt: null },
        })
      );
      return first.id;
    }
  );
}

/**
 * Retrying a run of an item with the setting: "busy" while another run of the
 * item is open, "moved_on" (queue_resume) once a later run exists.
 */
export async function itemRetryGuard(
  run: ItemRunKey & { agentConfig: unknown }
): Promise<"busy" | "moved_on" | null> {
  const setting = readSameItem(run.agentConfig);
  if (setting === WorkflowSameItem.Ignore) {
    return null;
  }
  const open = await withDb((db) =>
    db.workflowRun.findFirst({
      where: {
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        sourceKey: run.sourceKey,
        id: { not: run.id },
        status: { notIn: [...WORKFLOW_RUN_FINAL_STATUSES] },
      },
      select: { id: true },
    })
  );
  if (open) {
    return "busy";
  }
  if (setting !== WorkflowSameItem.QueueResume) {
    return null;
  }
  const later = await withDb((db) =>
    db.workflowRun.findFirst({
      where: {
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        sourceKey: run.sourceKey,
        OR: [
          { createdAt: { gt: run.createdAt } },
          { createdAt: run.createdAt, id: { gt: run.id } },
        ],
      },
      select: { id: true },
    })
  );
  return later ? "moved_on" : null;
}

function findOpenItemRuns(
  run: Pick<ItemRunKey, "id" | "organizationId" | "workflowId" | "sourceKey">
): Promise<ItemRunSummary[]> {
  return withDb(async (db) => {
    const rows = await db.workflowRun.findMany({
      where: {
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        sourceKey: run.sourceKey,
        id: { not: run.id },
        status: { notIn: [...WORKFLOW_RUN_FINAL_STATUSES] },
      },
      select: { id: true, status: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ITEM_RUNS_LIMIT,
    });
    return rows.map((row) => ({
      ...row,
      status: row.status as WorkflowRunStatus,
    }));
  });
}

function isEarlier(
  a: Pick<ItemRunKey, "id" | "createdAt">,
  b: Pick<ItemRunKey, "id" | "createdAt">
): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  if (diff === 0) {
    return a.id < b.id;
  }
  return diff < 0;
}

/** Waits for the previous run's reply (its final-event post rows), bounded. */
async function previousReplyWait(
  run: Pick<EngineRun, "id" | "organizationId">,
  key: ItemRunKey,
  now: Date
): Promise<StepOutcome | null> {
  const previous = await findPreviousItemRun(key);
  if (
    !(
      previous &&
      WORKFLOW_RUN_FINAL_STATUSES.includes(previous.status as WorkflowRunStatus)
    )
  ) {
    return null;
  }
  const open = await withDb((db) =>
    db.workflowActionRun.count({
      where: {
        runId: previous.id,
        stage: WorkflowActionStage.Post,
        cycle: previous.cycle,
        event: { in: FINAL_EVENTS },
        status: { in: OPEN_ACTION_STATUSES },
      },
    })
  );
  if (open === 0) {
    return null;
  }
  const endedAt = previous.completedAt ?? previous.updatedAt;
  if (now.getTime() >= endedAt.getTime() + ITEM_QUEUE_ACTIONS_WAIT_MS) {
    log.warn("workflow.run.item_queue_actions_timeout", {
      workflowRunId: run.id,
      organizationId: run.organizationId,
      previousRunId: previous.id,
      reason: "previous_run_actions_open",
    });
    return null;
  }
  return {
    kind: "retry",
    delayMs: ITEM_QUEUE_ACTIONS_RETRY_MS,
    error: runError(
      WorkflowRunErrorCode.ItemQueued,
      "Waiting for the earlier run of the same item to send its reply."
    ),
  };
}
