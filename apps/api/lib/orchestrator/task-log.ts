import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { log } from "@repo/observability/log";

/** Lifecycle lines of the orchestrator task transitions: ids and outcome only. */
export function logTaskQueued(
  input: { organizationId: string; caseId: string; turnId?: string | null },
  taskId: string,
  computeTargetId: string | null
): void {
  log.info("orchestrator.task.queued", {
    organizationId: input.organizationId,
    caseId: input.caseId,
    turnId: input.turnId,
    taskId,
    computeTargetId,
  });
}

export function logTaskStarted(taskId: string, loopId: string): void {
  log.info("orchestrator.task.started", { taskId, loopId });
}

export function logTaskSettled(
  taskId: string,
  loopId: string,
  succeeded: boolean
): void {
  log.info("orchestrator.task.settled", {
    taskId,
    loopId,
    status: succeeded
      ? OrchestratorTaskStatus.Succeeded
      : OrchestratorTaskStatus.Failed,
  });
}

export function logTaskFailed(taskId: string, reason: string): void {
  log.warn("orchestrator.task.failed", { taskId, reason });
}
