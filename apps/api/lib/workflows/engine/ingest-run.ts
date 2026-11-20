import {
  WORKFLOW_RUN_ACTIVE_STATUSES,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import type { InboundEvent } from "@/lib/integrations/types";
import { buildRunSource, toJsonObject } from "./run-data";

/**
 * Run creation of the ingest decision (ingest.ts decideRunLocked), split out
 * with the agent.sameItem branch (docs/workflows.md "Item queue").
 */

export const QueuedOutcome = {
  Created: "created",
  /** Created behind another active run of the item. */
  Queued: "queued",
  /** The item's needs_input run took the event as its answer. */
  Resumed: "resumed",
} as const;
export type QueuedOutcome = (typeof QueuedOutcome)[keyof typeof QueuedOutcome];

type RunTrigger = {
  id: string;
  workflowId: string;
  projectId: string;
  projectConnectionId: string | null;
  workflow: { agentConfig: unknown; runAsUserId: string | null };
};

type RunKeys = { dedupKey: string; sourceKey: string; deliveryRowId: string };

export type NewRunInput = {
  organizationId: string;
  connectionId: string;
  event: InboundEvent;
  trigger: RunTrigger;
  keys: RunKeys;
};

/**
 * agent.sameItem (queue, queue_resume): an event while the item has a
 * needs_input run is that run's answer; otherwise it creates a run, with a
 * createdAt after the item's latest run so the order is the decision order.
 * Runs inside the ingest advisory lock.
 */
export async function decideQueuedLocked(
  input: NewRunInput & {
    resume: (run: { id: string; cycle: number }, now: Date) => Promise<boolean>;
  }
): Promise<{ outcome: QueuedOutcome; runId: string }> {
  const { trigger, keys } = input;
  const item = {
    organizationId: input.organizationId,
    workflowId: trigger.workflowId,
    sourceKey: keys.sourceKey,
  };
  const now = new Date();
  const needsInput = await withDb((db) =>
    db.workflowRun.findFirst({
      where: { ...item, status: WorkflowRunStatus.NeedsInput },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, cycle: true },
    })
  );
  if (needsInput && (await input.resume(needsInput, now))) {
    return { outcome: QueuedOutcome.Resumed, runId: needsInput.id };
  }
  const latest = await withDb((db) =>
    db.workflowRun.findFirst({
      where: item,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    })
  );
  const active = await withDb((db) =>
    db.workflowRun.findFirst({
      where: { ...item, status: { in: [...WORKFLOW_RUN_ACTIVE_STATUSES] } },
      select: { id: true },
    })
  );
  const createdAt = latest
    ? new Date(Math.max(now.getTime(), latest.createdAt.getTime() + 1))
    : now;
  const runId = await createRun(input, now, createdAt);
  if (!active) {
    return { outcome: QueuedOutcome.Created, runId };
  }
  log.info("workflow.run.queued", {
    workflowRunId: runId,
    organizationId: input.organizationId,
    projectId: trigger.projectId,
    behindRunId: active.id,
  });
  return { outcome: QueuedOutcome.Queued, runId };
}

/** Creates the run and stamps the workflow's lastRunAt; createdAt only when the item queue orders it. */
export async function createRun(
  input: NewRunInput,
  now: Date,
  createdAt?: Date
): Promise<string> {
  const { trigger, keys, event } = input;
  const run = await withDb((db) =>
    db.workflowRun.create({
      data: {
        organizationId: input.organizationId,
        workflowId: trigger.workflowId,
        projectId: trigger.projectId,
        projectConnectionId: trigger.projectConnectionId,
        triggerId: trigger.id,
        connectionId: input.connectionId,
        deliveryId: keys.deliveryRowId,
        runAsUserId: trigger.workflow.runAsUserId,
        dedupKey: keys.dedupKey,
        sourceKey: keys.sourceKey,
        status: WorkflowRunStatus.Received,
        source: buildRunSource(event),
        agentConfig: toJsonObject(trigger.workflow.agentConfig),
        phaseStartedAt: now,
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true },
    })
  );
  await withDb((db) =>
    db.workflow.updateMany({
      where: { id: trigger.workflowId },
      data: { lastRunAt: now },
    })
  );
  log.info("workflow.run.received", {
    workflowRunId: run.id,
    organizationId: input.organizationId,
    projectId: trigger.projectId,
    sourceKind: event.triggerType,
  });
  return run.id;
}
