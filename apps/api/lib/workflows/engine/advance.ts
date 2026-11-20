import { setTimeout as sleep } from "node:timers/promises";
import {
  type ProcessStep,
  ProcessStepType,
} from "@repo/api/src/types/project-process";
import { Result } from "@repo/api/src/types/result";
import {
  WORKFLOW_RUN_FINAL_STATUSES,
  type WorkflowRunError,
  WorkflowRunErrorCode,
  WorkflowRunRetryMode,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import { Prisma, withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { waitUntil } from "@/lib/wait-until";
import {
  drainActionRuns,
  enqueueRunEvents,
  hasPostEvents,
  RUN_CANCELLED_SKIP_REASON,
  skipPendingPostActionRuns,
  skipUnfinishedPreActionRuns,
} from "./actions";
import { stepStartedEvents } from "./agent-step";
import { resumeFailedStep } from "./agent-step-resume";
import { cancelRunLoops } from "./cancel";
import { runError } from "./errors";
import {
  itemRetryGuard,
  loadItemRunKey,
  nextQueuedItemRun,
  readSameItem,
} from "./item-queue";
import { enterStep, loadRunContext, runPhaseStep } from "./phases";
import { resolveRunProcess } from "./process";
import {
  findResumableLoop,
  findRetryableStep,
  RETRYABLE_RUN_STATUSES,
} from "./retry-step";
import { readAgentConfig, readRunSource, readRunStatus } from "./run-data";
import type { RunLoopState } from "./run-loops";
import {
  type EngineRun,
  failRun,
  type StepContext,
  type StepOutcome,
} from "./step-outcome";
import { stepDueFilter } from "./step-retry";

/**
 * The run state machine driver (docs/workflows.md "Run state machine").
 * `advanceRun` is the only writer of run status. It is idempotent and guarded
 * by a lease: a webhook-triggered advance and the scheduler sweep never step
 * the same run at the same time. Long inline work (pre actions) renews the
 * lease before each action. Every status change sets phaseStartedAt, resets
 * the step retry state (stepAttempts, nextStepAt) and enqueues the run events
 * of the transition in the same transaction. A step that hit a temporary
 * failure (e.g. the source system rate limited the import) keeps the status
 * and sets nextStepAt; the run is not advanced before that time.
 */

export const RUN_LEASE_MS = 2 * 60_000;
/**
 * Transitions applied per call (received -> pre_actions -> ingesting ->
 * planning -> ...).
 */
const MAX_STEPS_PER_ADVANCE = 6;
const CANCEL_LEASE_ATTEMPTS = 10;
const CANCEL_LEASE_RETRY_MS = 500;
const LOG_PREFIX = "[workflows/advance]";
const UNFINISHED_PRE_ACTION_REASON =
  "The run stopped before this pre action ran.";

export const AdvanceRunOutcome = {
  /**
   * Another worker holds the lease, the run waits for a step retry
   * (nextStepAt in the future), or the run is final or missing.
   */
  Skipped: "skipped",
  Advanced: "advanced",
} as const;
export type AdvanceRunOutcome =
  (typeof AdvanceRunOutcome)[keyof typeof AdvanceRunOutcome];

export const CancelRunFailure = {
  NotFound: "not_found",
  AlreadyFinished: "already_finished",
  Busy: "busy",
} as const;
export type CancelRunFailure =
  (typeof CancelRunFailure)[keyof typeof CancelRunFailure];

/**
 * Moves the run forward as far as it can go now. Never throws. A run whose
 * step waits for a retry (nextStepAt after `now`) is skipped.
 */
export async function advanceRun(
  runId: string,
  now: Date = new Date()
): Promise<AdvanceRunOutcome> {
  const row = await readRunSpanContext(runId);
  return withSpan(
    "workflow.advance_run",
    {
      [AfAttribute.WorkflowRunId]: runId,
      [AfAttribute.OrgId]: row?.organizationId,
      [AfAttribute.ProjectId]: row?.projectId ?? undefined,
    },
    async (span) => {
      const leaseUntil = await acquireLease(runId, now, stepDueFilter(now));
      if (!leaseUntil) {
        setSpanOutcome(AfOutcome.Skipped, undefined, span);
        return AdvanceRunOutcome.Skipped;
      }
      const lease: RunLease = { runId, until: leaseUntil };
      try {
        await stepUntilWaiting(runId, {
          now,
          renewLease: () => renewLease(lease),
        });
      } catch (error) {
        log.error(`${LOG_PREFIX} Run step failed; retrying on the next tick`, {
          runId,
          error,
        });
        setSpanOutcome(AfOutcome.Error, parseError(error), span);
      } finally {
        await releaseLease(lease);
      }
      return AdvanceRunOutcome.Advanced;
    },
    { links: [readRunSource(row?.source)?.traceparent] }
  );
}

/**
 * Cancels a non-final run: takes the lease (waiting briefly for an advance in
 * progress), cancels the run's active loops, then writes `cancelled`.
 */
export function cancelRun(
  organizationId: string,
  runId: string
): Promise<Result<null, CancelRunFailure>> {
  return withSpan(
    "workflow.cancel_run",
    { [AfAttribute.WorkflowRunId]: runId, [AfAttribute.OrgId]: organizationId },
    async (span) => {
      const result = await cancelRunLocked(organizationId, runId);
      if (!result.ok) {
        setSpanOutcome(AfOutcome.Error, result.error, span);
      }
      return result;
    }
  );
}

async function cancelRunLocked(
  organizationId: string,
  runId: string
): Promise<Result<null, CancelRunFailure>> {
  const current = await withDb((db) =>
    db.workflowRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    })
  );
  if (!current) {
    return Result.err(CancelRunFailure.NotFound);
  }
  if (isFinal(readRunStatus(current.status))) {
    return Result.err(CancelRunFailure.AlreadyFinished);
  }
  const leaseUntil = await acquireLeaseWithRetry(runId);
  if (!leaseUntil) {
    return Result.err(CancelRunFailure.Busy);
  }
  const lease: RunLease = { runId, until: leaseUntil };
  try {
    const run = await loadEngineRun(runId);
    if (!run || isFinal(run.status)) {
      return Result.err(CancelRunFailure.AlreadyFinished);
    }
    await cancelRunLoops(run.id, organizationId);
    const applied = await applyTransition(run, new Date(), {
      kind: "transition",
      status: WorkflowRunStatus.Cancelled,
      events: [],
      data: {
        error: runError(
          WorkflowRunErrorCode.Cancelled,
          "The run was cancelled by a workflow administrator."
        ),
      },
    });
    if (!applied) {
      return Result.err(CancelRunFailure.Busy);
    }
    await skipPendingPostActionRuns(run.id, RUN_CANCELLED_SKIP_REASON);
    return Result.ok(null);
  } finally {
    await releaseLease(lease);
  }
}

export const RetryRunFailure = {
  NotFound: "not_found",
  NotRetryable: "not_retryable",
  /** Resume was asked, but the step has no agent session to go on with. */
  NotResumable: "not_resumable",
  /** The step could not be started; `error` says why. The run stays failed. */
  StartFailed: "start_failed",
  Busy: "busy",
  /** agent.sameItem: another run of the same item is open. */
  ItemBusy: "item_busy",
  /** agent.sameItem queue_resume: a later run of the item continued its session and folder. */
  ItemMovedOn: "item_moved_on",
} as const;
export type RetryRunFailure =
  (typeof RetryRunFailure)[keyof typeof RetryRunFailure];

/**
 * Runs the step a run failed or was cancelled in again (retry-step.ts):
 * takes the run's lease, launches the step's loop and writes its status.
 */
export function retryRun(
  organizationId: string,
  runId: string,
  mode: WorkflowRunRetryMode = WorkflowRunRetryMode.Restart
): Promise<
  Result<null, { failure: RetryRunFailure; error?: WorkflowRunError }>
> {
  return withSpan(
    "workflow.retry_run",
    { [AfAttribute.WorkflowRunId]: runId, [AfAttribute.OrgId]: organizationId },
    async (span) => {
      const result = await retryRunLocked(organizationId, runId, mode);
      if (!result.ok) {
        setSpanOutcome(AfOutcome.Error, result.error.failure, span);
      }
      return result;
    }
  );
}

async function retryRunLocked(
  organizationId: string,
  runId: string,
  mode: WorkflowRunRetryMode
): Promise<
  Result<null, { failure: RetryRunFailure; error?: WorkflowRunError }>
> {
  const now = new Date();
  const leaseUntil = await acquireFailedRunLease(organizationId, runId, now);
  if (!leaseUntil) {
    const current = await withDb((db) =>
      db.workflowRun.findFirst({
        where: { id: runId, organizationId },
        select: { status: true },
      })
    );
    return Result.err({
      failure: current
        ? RetryRunFailure.NotRetryable
        : RetryRunFailure.NotFound,
    });
  }
  const lease: RunLease = { runId, until: leaseUntil };
  try {
    const run = await loadEngineRun(runId);
    const blocked = run ? await retryBlockedByItem(run) : null;
    if (blocked) {
      return Result.err({ failure: blocked });
    }
    const error = await withDb((db) =>
      db.workflowRun.findUnique({
        where: { id: runId },
        select: { error: true },
      })
    );
    const step = run
      ? findRetryableStep({ ...run, error: error?.error })
      : null;
    if (!(run && step)) {
      return Result.err({ failure: RetryRunFailure.NotRetryable });
    }
    const resumeFrom =
      mode === WorkflowRunRetryMode.Resume
        ? await findResumableLoop(run.id, step)
        : null;
    if (mode === WorkflowRunRetryMode.Resume && !resumeFrom) {
      return Result.err({ failure: RetryRunFailure.NotResumable });
    }
    const outcome = await retryFailedStep(run, step, now, resumeFrom);
    if (outcome.kind !== "transition") {
      return Result.err({ failure: RetryRunFailure.Busy });
    }
    if (outcome.status === WorkflowRunStatus.Failed) {
      return Result.err({
        failure: RetryRunFailure.StartFailed,
        error: outcome.data?.error ?? undefined,
      });
    }
    const applied = await applyTransition(run, now, outcome);
    return applied
      ? Result.ok(null)
      : Result.err({ failure: RetryRunFailure.Busy });
  } finally {
    await releaseLease(lease);
  }
}

export function isFinal(status: WorkflowRunStatus): boolean {
  return WORKFLOW_RUN_FINAL_STATUSES.includes(status);
}

const ENGINE_RUN_SELECT = {
  id: true,
  organizationId: true,
  workflowId: true,
  status: true,
  cycle: true,
  source: true,
  agentConfig: true,
  runAsUserId: true,
  connectionId: true,
  projectId: true,
  projectConnectionId: true,
  featureDocumentId: true,
  planDocumentId: true,
  phaseStartedAt: true,
  stepAttempts: true,
  process: true,
  stepId: true,
  stepState: true,
  workflow: { select: { name: true, enabled: true } },
} as const;

/** The lease this advance holds; `until` moves forward when it is renewed. */
type RunLease = { runId: string; until: Date };

async function stepUntilWaiting(
  runId: string,
  context: StepContext
): Promise<void> {
  for (let step = 0; step < MAX_STEPS_PER_ADVANCE; step++) {
    const run = await loadEngineRun(runId);
    if (!run || isFinal(run.status)) {
      return;
    }
    const outcome = await runStepSafely(run, context);
    if (outcome.kind === "wait") {
      return;
    }
    if (outcome.kind === "retry") {
      await scheduleStepRetry(run, context.now, outcome);
      return;
    }
    const applied = await applyTransition(run, context.now, outcome);
    if (!applied || isFinal(outcome.status)) {
      return;
    }
  }
}

/**
 * Unexpected errors fail runs that are still being set up (a retry would hit
 * the same error forever); in the waiting phases they are retried on the next
 * tick, bounded by the phase timeout.
 */
async function runStepSafely(
  run: EngineRun,
  context: StepContext
): Promise<StepOutcome> {
  try {
    return await runPhaseStep(run, context);
  } catch (error) {
    if (
      run.status !== WorkflowRunStatus.Received &&
      run.status !== WorkflowRunStatus.Ingesting
    ) {
      throw error;
    }
    log.error(`${LOG_PREFIX} Run setup failed unexpectedly`, {
      runId: run.id,
      organizationId: run.organizationId,
      error,
    });
    return failRun(
      runError(
        WorkflowRunErrorCode.InternalError,
        `The run could not be started: ${parseError(error)}`
      )
    );
  }
}

/**
 * Writes the new status (guarded by the current one) and enqueues the
 * transition's events in one transaction, then drains the post actions in the
 * background. A run that stops while in pre_actions marks the pre action runs
 * that never ran as skipped.
 */
async function applyTransition(
  run: EngineRun,
  now: Date,
  outcome: Extract<StepOutcome, { kind: "transition" }>
): Promise<boolean> {
  const cycle = outcome.data?.cycle ?? run.cycle;
  const applied = await withDb.tx(async (tx) => {
    const updated = await tx.workflowRun.updateMany({
      where: { id: run.id, status: run.status },
      data: toRunUpdate(outcome, now),
    });
    if (updated.count === 0) {
      return false;
    }
    await enqueueRunEvents(
      {
        id: run.id,
        organizationId: run.organizationId,
        workflowId: run.workflowId,
        cycle,
      },
      outcome.events,
      now
    );
    if (
      run.status === WorkflowRunStatus.PreActions &&
      isFinal(outcome.status)
    ) {
      await skipUnfinishedPreActionRuns(
        { id: run.id, cycle: run.cycle },
        UNFINISHED_PRE_ACTION_REASON
      );
    }
    return true;
  });
  if (applied) {
    logTransition(run, outcome);
    if (
      isFinal(outcome.status) &&
      readSameItem(run.agentConfig) !== WorkflowSameItem.Ignore
    ) {
      waitUntil(() => finishItemRun(run.id, run.organizationId));
    } else if (hasPostEvents(outcome.events)) {
      waitUntil(drainActionRuns({ runId: run.id }));
    }
  }
  return applied;
}

/**
 * Keeps the status and schedules the step again after its backoff
 * (stepAttempts + 1, nextStepAt). advanceRun skips the run until then.
 */
async function scheduleStepRetry(
  run: EngineRun,
  now: Date,
  outcome: Extract<StepOutcome, { kind: "retry" }>
): Promise<void> {
  const nextStepAt = new Date(now.getTime() + outcome.delayMs);
  await withDb((db) =>
    db.workflowRun.updateMany({
      where: { id: run.id, status: run.status },
      data: { stepAttempts: run.stepAttempts + 1, nextStepAt },
    })
  );
  if (outcome.error.code === WorkflowRunErrorCode.ItemQueued) {
    log.debug("workflow.run.queued_wait", {
      workflowRunId: run.id,
      organizationId: run.organizationId,
      attempt: run.stepAttempts + 1,
      nextStepAt,
    });
    return;
  }
  log.warn(`${LOG_PREFIX} Run step failed temporarily; retrying later`, {
    runId: run.id,
    organizationId: run.organizationId,
    status: run.status,
    attempt: run.stepAttempts + 1,
    nextStepAt,
    errorCode: outcome.error.code,
    error: outcome.error.message,
  });
}

async function loadEngineRun(runId: string): Promise<EngineRun | null> {
  const row = await withDb((db) =>
    db.workflowRun.findUnique({
      where: { id: runId },
      select: ENGINE_RUN_SELECT,
    })
  );
  return row ? { ...row, status: readRunStatus(row.status) } : null;
}

/**
 * `extra` narrows which runs may be leased (advanceRun: only runs whose step
 * is due); cancel takes the lease regardless of a scheduled retry.
 */
async function acquireLease(
  runId: string,
  now: Date,
  extra?: Prisma.WorkflowRunWhereInput
): Promise<Date | null> {
  const leaseUntil = new Date(now.getTime() + RUN_LEASE_MS);
  const result = await withDb((db) =>
    db.workflowRun.updateMany({
      where: {
        id: runId,
        status: { notIn: [...WORKFLOW_RUN_FINAL_STATUSES] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        ...(extra ? { AND: [extra] } : {}),
      },
      data: { leaseUntil },
    })
  );
  return result.count === 1 ? leaseUntil : null;
}

/** The lease of a failed or cancelled run, which acquireLease never grants (it is final). */
async function acquireFailedRunLease(
  organizationId: string,
  runId: string,
  now: Date
): Promise<Date | null> {
  const leaseUntil = new Date(now.getTime() + RUN_LEASE_MS);
  const result = await withDb((db) =>
    db.workflowRun.updateMany({
      where: {
        id: runId,
        organizationId,
        status: { in: [...RETRYABLE_RUN_STATUSES] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil },
    })
  );
  return result.count === 1 ? leaseUntil : null;
}

async function acquireLeaseWithRetry(runId: string): Promise<Date | null> {
  for (let attempt = 0; attempt < CANCEL_LEASE_ATTEMPTS; attempt++) {
    const lease = await acquireLease(runId, new Date());
    if (lease) {
      return lease;
    }
    if (attempt < CANCEL_LEASE_ATTEMPTS - 1) {
      await sleep(CANCEL_LEASE_RETRY_MS);
    }
  }
  return null;
}

/**
 * Moves our lease to RUN_LEASE_MS from now. Returns false when the lease is no
 * longer ours (it expired and another worker took the run).
 */
async function renewLease(lease: RunLease): Promise<boolean> {
  const until = new Date(Date.now() + RUN_LEASE_MS);
  if (until.getTime() <= lease.until.getTime()) {
    return true;
  }
  const renewed = await withDb((db) =>
    db.workflowRun.updateMany({
      where: { id: lease.runId, leaseUntil: lease.until },
      data: { leaseUntil: until },
    })
  );
  if (renewed.count === 0) {
    return false;
  }
  lease.until = until;
  return true;
}

/** Releases only our own lease (a lease that expired may belong to another worker). */
async function releaseLease(lease: RunLease): Promise<void> {
  try {
    await withDb((db) =>
      db.workflowRun.updateMany({
        where: { id: lease.runId, leaseUntil: lease.until },
        data: { leaseUntil: null },
      })
    );
  } catch (error) {
    log.warn(`${LOG_PREFIX} Could not release the run lease`, {
      runId: lease.runId,
      error,
    });
  }
}

/** undefined leaves a column alone; null clears it. */
function toRunUpdate(
  outcome: Extract<StepOutcome, { kind: "transition" }>,
  now: Date
): Prisma.WorkflowRunUpdateManyMutationInput {
  const data = outcome.data ?? {};
  const update: Prisma.WorkflowRunUpdateManyMutationInput = {
    status: outcome.status,
    phaseStartedAt: now,
    stepAttempts: 0,
    nextStepAt: null,
  };
  // A retried run leaves `failed`, so it is not complete any more.
  update.completedAt = isFinal(outcome.status) ? now : null;
  if (data.error !== undefined) {
    update.error = data.error ?? Prisma.DbNull;
  }
  if (data.prUrl !== undefined) {
    update.prUrl = data.prUrl;
  }
  if (data.branchName !== undefined) {
    update.branchName = data.branchName;
  }
  if (data.cycle !== undefined) {
    update.cycle = data.cycle;
  }
  if (data.stepId !== undefined) {
    update.stepId = data.stepId;
  }
  if (data.process !== undefined) {
    update.process = data.process;
  }
  if (data.stepState !== undefined) {
    update.stepState = data.stepState ?? Prisma.DbNull;
  }
  return update;
}

function logTransition(
  run: EngineRun,
  outcome: Extract<StepOutcome, { kind: "transition" }>
): void {
  log.info(`${LOG_PREFIX} Run status changed`, {
    runId: run.id,
    organizationId: run.organizationId,
    workflowId: run.workflowId,
    from: run.status,
    to: outcome.status,
    events: outcome.events,
    errorCode: outcome.data?.error?.code ?? null,
  });
}

/**
 * The transition that runs `step` (findRetryableStep) again: its loop is
 * launched and the run takes the step's status. A failure outcome means the
 * step could not be started (the run stays failed; the caller reports it).
 */
async function retryFailedStep(
  run: EngineRun,
  step: ProcessStep,
  now: Date,
  resumeFrom: RunLoopState | null
): Promise<StepOutcome> {
  if (!run.workflow.enabled) {
    return failRun(
      runError(
        WorkflowRunErrorCode.WorkflowDisabled,
        "The workflow is disabled."
      )
    );
  }
  const agent = readAgentConfig(run.agentConfig);
  if (!agent) {
    return failRun(
      runError(
        WorkflowRunErrorCode.AgentConfigInvalid,
        "The run's agent configuration is invalid."
      )
    );
  }
  const data = { cycle: run.cycle + 1, error: null, stepState: null };
  if (resumeFrom && step.type === ProcessStepType.Agent) {
    const context = await loadRunContext(run);
    if (!context.ok) {
      return failRun(context.error);
    }
    return await resumeFailedStep({
      run,
      ...context.value,
      step,
      loop: resumeFrom,
      events: stepStartedEvents(step),
      data,
    });
  }
  return await enterStep({
    run,
    agent,
    runProcess: resolveRunProcess(run.process, agent),
    step,
    events: [],
    data,
    now,
  });
}

async function readRunSpanContext(runId: string): Promise<{
  source: unknown;
  organizationId: string;
  projectId: string | null;
} | null> {
  try {
    return await withDb((db) =>
      db.workflowRun.findUnique({
        where: { id: runId },
        select: { source: true, organizationId: true, projectId: true },
      })
    );
  } catch (error) {
    log.warn("workflow.run_source_read_failed", {
      workflowRunId: runId,
      reason: "run_read_failed",
      error,
    });
    return null;
  }
}

/**
 * A run of an item with agent.sameItem ended: sends its reply, then starts the
 * next queued run of the item at once (item-queue.ts).
 */
async function finishItemRun(
  runId: string,
  organizationId: string
): Promise<void> {
  await drainActionRuns({ runId });
  const next = await nextQueuedItemRun(runId, organizationId);
  if (next) {
    await advanceRun(next);
  }
}

/** agent.sameItem: why a run of a busy or moved-on item cannot be retried (no query without the setting). */
async function retryBlockedByItem(
  run: Pick<EngineRun, "id" | "organizationId" | "agentConfig">
): Promise<RetryRunFailure | null> {
  if (readSameItem(run.agentConfig) === WorkflowSameItem.Ignore) {
    return null;
  }
  const key = await loadItemRunKey(run.id, run.organizationId);
  const guard = key
    ? await itemRetryGuard({ ...key, agentConfig: run.agentConfig })
    : null;
  if (guard === "busy") {
    return RetryRunFailure.ItemBusy;
  }
  return guard === "moved_on" ? RetryRunFailure.ItemMovedOn : null;
}
