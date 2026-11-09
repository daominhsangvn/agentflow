import {
  AGENT_RECENT_WORK_MAX,
  type AgentCapabilityFile,
  type AgentRecentWork,
  type AgentToolCheck,
  type AgentUsageWindow,
  AgentWorkKind,
  AgentWorkStatus,
} from "@repo/api/src/types/agent-fleet";
import { LoopStatus } from "@repo/api/src/types/loop";
import {
  ORCHESTRATOR_TASK_BLOCKED_PREFIX,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import {
  type RunnerCapabilitiesSource,
  runnerCapabilitiesSchema,
} from "@repo/api/src/types/runner-capabilities";
import { z } from "zod";
import type { UsageTotals } from "@/lib/usage/loop-usage";

/** Pure mappers for the agent detail response. */

export type CapabilityFileRow = {
  projectId: string;
  source: string;
  capabilities: unknown;
  problems: unknown;
  warnings: unknown;
  uploadedAt: Date;
  project: { id: string; name: string };
};

export type RecentTaskRow = {
  id: string;
  command: string;
  status: string;
  result: unknown;
  loopId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  case: { id: string; title: string };
};

export type RecentLoopRow = {
  id: string;
  command: string;
  status: LoopStatus;
  createdAt: Date;
  completedAt: Date | null;
  workflowRunLoop: {
    run: { id: string; workflowId: string; sourceKey: string };
  } | null;
};

export type StatusCount = { status: string; _count: { _all: number } };

export type WindowCounts = {
  taskCounts: StatusCount[];
  blocked: number;
  loopCounts: StatusCount[];
};

export function toHealthTools(result: unknown): AgentToolCheck[] {
  return healthResultSchema.parse(result).checks.map((check) => ({
    id: check.id,
    label: check.label,
    required: check.required,
    passed: check.passed,
    version: check.version ?? null,
  }));
}

export function toCapabilityFile(row: CapabilityFileRow): AgentCapabilityFile {
  const parsed = runnerCapabilitiesSchema.safeParse(row.capabilities);
  return {
    projectId: row.projectId,
    projectName: row.project.name,
    source: row.source as RunnerCapabilitiesSource,
    roleName: parsed.success ? parsed.data.runner : null,
    commands: parsed.success ? parsed.data.commands : [],
    problems: stringListSchema.parse(row.problems),
    warnings: stringListSchema.parse(row.warnings),
    uploaded: row.uploadedAt.toISOString(),
  };
}

export function isBlockedResult(result: unknown): boolean {
  const parsed = replyResultSchema.safeParse(result);
  return (
    parsed.success &&
    parsed.data.reply.startsWith(ORCHESTRATOR_TASK_BLOCKED_PREFIX)
  );
}

export function taskWorkStatus(
  status: string,
  result: unknown
): AgentWorkStatus {
  switch (status) {
    case OrchestratorTaskStatus.Queued:
      return AgentWorkStatus.Queued;
    case OrchestratorTaskStatus.Running:
      return AgentWorkStatus.Running;
    case OrchestratorTaskStatus.Succeeded:
      return isBlockedResult(result)
        ? AgentWorkStatus.Blocked
        : AgentWorkStatus.Succeeded;
    case OrchestratorTaskStatus.Failed:
      return AgentWorkStatus.Failed;
    default:
      return AgentWorkStatus.Cancelled;
  }
}

export function loopWorkStatus(status: LoopStatus): AgentWorkStatus {
  switch (status) {
    case LoopStatus.Pending:
    case LoopStatus.Claimed:
    case LoopStatus.Blocked:
      return AgentWorkStatus.Queued;
    case LoopStatus.Running:
      return AgentWorkStatus.Running;
    case LoopStatus.Completed:
      return AgentWorkStatus.Succeeded;
    case LoopStatus.Failed:
    case LoopStatus.TimedOut:
      return AgentWorkStatus.Failed;
    default:
      return AgentWorkStatus.Cancelled;
  }
}

/** Newest first by start, capped. Usage comes from `loadLoopUsage` by loop id. */
export function mergeRecentWork(
  tasks: RecentTaskRow[],
  loops: RecentLoopRow[],
  usageByLoop: Map<string, UsageTotals>,
  max: number = AGENT_RECENT_WORK_MAX
): AgentRecentWork[] {
  const taskWork = tasks.map((task) =>
    toWork(
      {
        id: task.id,
        kind: AgentWorkKind.Task,
        command: task.command,
        status: taskWorkStatus(task.status, task.result),
        caseId: task.case.id,
        caseTitle: task.case.title,
        runId: null,
        workflowId: null,
        label: task.case.title,
        started: task.createdAt,
        finished: task.finishedAt,
      },
      task.loopId === null ? undefined : usageByLoop.get(task.loopId)
    )
  );
  const loopWork = loops.map((loop) =>
    toWork(
      {
        id: loop.id,
        kind: AgentWorkKind.RunLoop,
        command: loop.command,
        status: loopWorkStatus(loop.status),
        caseId: null,
        caseTitle: null,
        runId: loop.workflowRunLoop?.run.id ?? null,
        workflowId: loop.workflowRunLoop?.run.workflowId ?? null,
        label: loop.workflowRunLoop?.run.sourceKey ?? loop.command,
        started: loop.createdAt,
        finished: loop.completedAt,
      },
      usageByLoop.get(loop.id)
    )
  );
  return [...taskWork, ...loopWork]
    .sort((a, b) => b.started.localeCompare(a.started))
    .slice(0, max);
}

/**
 * Counts per window. `succeeded` excludes BLOCKED tasks; run TIMED_OUT loops
 * count as failed.
 */
export function usageWindow(
  counts: WindowCounts,
  totals: UsageTotals
): AgentUsageWindow {
  const taskSucceeded = countOf(
    counts.taskCounts,
    OrchestratorTaskStatus.Succeeded
  );
  const taskFailed = countOf(counts.taskCounts, OrchestratorTaskStatus.Failed);
  const loopSucceeded = countOf(counts.loopCounts, LoopStatus.Completed);
  const loopFailed =
    countOf(counts.loopCounts, LoopStatus.Failed) +
    countOf(counts.loopCounts, LoopStatus.TimedOut);
  const succeeded = Math.max(0, taskSucceeded - counts.blocked) + loopSucceeded;
  const failed = taskFailed + loopFailed;
  return {
    tasks: succeeded + failed + counts.blocked,
    succeeded,
    failed,
    blocked: counts.blocked,
    activeMs: totals.activeMs,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.costUsd,
  };
}

const healthResultSchema = z
  .object({
    checks: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          required: z.boolean(),
          passed: z.boolean(),
          version: z.string().optional(),
        })
      )
      .catch([]),
  })
  .catch({ checks: [] });
const stringListSchema = z.array(z.string()).catch([]);
const replyResultSchema = z.object({ reply: z.string() });

function countOf(counts: StatusCount[], status: string): number {
  return counts.find((row) => row.status === status)?._count._all ?? 0;
}

function toWork(
  base: {
    id: string;
    kind: AgentWorkKind;
    command: string;
    status: AgentWorkStatus;
    caseId: string | null;
    caseTitle: string | null;
    runId: string | null;
    workflowId: string | null;
    label: string;
    started: Date;
    finished: Date | null;
  },
  usage: UsageTotals | undefined
): AgentRecentWork {
  return {
    ...base,
    started: base.started.toISOString(),
    finished: base.finished?.toISOString() ?? null,
    activeMs: usage?.activeMs ?? 0,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: usage?.costUsd ?? null,
  };
}
