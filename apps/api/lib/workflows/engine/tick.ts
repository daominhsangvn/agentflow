import { WORKFLOW_RUN_FINAL_STATUSES } from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";
import { AfOutcome } from "@repo/observability/af-attributes";
import { parseError } from "@repo/observability/error";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import pLimit from "p-limit";
import { mapWithDbConcurrency } from "@/lib/db-fanout";
import { advanceDueConversations } from "@/lib/orchestrator/advance";
import {
  type ActionDrainCounts,
  drainActionRuns,
  requeueStaleActionRuns,
} from "./actions";
import { AdvanceRunOutcome, advanceRun } from "./advance";
import { type PollSummary, pollDueConnections } from "./poll";
import { stepDueFilter } from "./step-retry";

/**
 * One scheduler tick (docs/workflows.md "Scheduler"): poll due connections,
 * advance runs that are neither final nor leased nor waiting for a step retry
 * (oldest first; this resumes runs whose pre actions wait for a retry, and
 * retries a failed import once its nextStepAt passed), requeue stale post
 * action runs, drain due post action runs. Each stage is isolated: a failing
 * stage is reported in `errors` and the next stages still run.
 */

export const TICK_ADVANCE_LIMIT = 50;
export const TICK_DRAIN_LIMIT = 50;
/** Runs advanced in parallel; launches await the desktop dispatch. */
const TICK_ADVANCE_CONCURRENCY = 4;
const LOG_PREFIX = "[workflows/tick]";

export type WorkflowTickResult = {
  poll: PollSummary;
  runs: { checked: number; advanced: number };
  actionRuns: ActionDrainCounts & { requeued: number };
  /** Project orchestrator: tasks started, waits fired, conversations moved. */
  orchestrator: { advanced: number; tasksLaunched: number; waitsFired: number };
  errors: string[];
  durationMs: number;
};

export function runWorkflowTick(
  now: Date = new Date()
): Promise<WorkflowTickResult> {
  return withSpan("workflow.tick", {}, () => runTickStages(now));
}

async function runTickStages(now: Date): Promise<WorkflowTickResult> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const poll = await runStage(
    errors,
    WorkflowTickStage.Poll,
    () => pollDueConnections(now),
    {
      polled: 0,
      failed: 0,
      events: 0,
      runs: 0,
    }
  );
  const runs = await runStage(
    errors,
    WorkflowTickStage.Advance,
    () => advanceDueRuns(now),
    {
      checked: 0,
      advanced: 0,
    }
  );
  const requeued = await runStage(
    errors,
    WorkflowTickStage.Requeue,
    () => requeueStaleActionRuns(now),
    0
  );
  const drained = await runStage(
    errors,
    WorkflowTickStage.Drain,
    () => drainActionRuns({ limit: TICK_DRAIN_LIMIT, now }),
    { claimed: 0, succeeded: 0, skipped: 0, retried: 0, failed: 0 }
  );
  const orchestrator = await runStage(
    errors,
    WorkflowTickStage.Orchestrator,
    () => advanceDueConversations(now),
    { advanced: 0, tasksLaunched: 0, waitsFired: 0 }
  );
  return {
    poll,
    runs,
    actionRuns: { ...drained, requeued },
    orchestrator,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

async function advanceDueRuns(
  now: Date
): Promise<{ checked: number; advanced: number }> {
  const due = await withDb((db) =>
    db.workflowRun.findMany({
      where: {
        status: { notIn: [...WORKFLOW_RUN_FINAL_STATUSES] },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
        AND: [stepDueFilter(now)],
      },
      orderBy: { updatedAt: "asc" },
      take: TICK_ADVANCE_LIMIT,
      select: { id: true },
    })
  );
  const outcomes = await mapWithDbConcurrency(
    due,
    (run) => advanceRun(run.id),
    pLimit(TICK_ADVANCE_CONCURRENCY)
  );
  return {
    checked: due.length,
    advanced: outcomes.filter(
      (outcome) => outcome === AdvanceRunOutcome.Advanced
    ).length,
  };
}

function runStage<T>(
  errors: string[],
  stage: WorkflowTickStage,
  work: () => Promise<T>,
  fallback: T
): Promise<T> {
  return withSpan(`workflow.tick.${stage}`, {}, async (span) => {
    try {
      return await work();
    } catch (error) {
      log.error(`${LOG_PREFIX} Stage failed`, { stage, error });
      errors.push(`${stage}: ${parseError(error)}`);
      setSpanOutcome(AfOutcome.Error, parseError(error), span);
      return fallback;
    }
  });
}

export const WorkflowTickStage = {
  Poll: "poll",
  Advance: "advance",
  Requeue: "requeue",
  Drain: "drain",
  Orchestrator: "orchestrator",
} as const;
export type WorkflowTickStage =
  (typeof WorkflowTickStage)[keyof typeof WorkflowTickStage];
