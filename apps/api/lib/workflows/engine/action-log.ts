import { WorkflowActionRunStatus } from "@repo/api/src/types/workflow";
import { log } from "@repo/observability/log";

type ActionLogRow = {
  id: string;
  runId: string;
  actionType: string;
};

type ActionLogSettlement = {
  status: WorkflowActionRunStatus;
  lastError?: string | null;
  nextAttemptAt?: Date | null;
};

/** Lifecycle line for an action run that was just settled (rule O3). */
export function logActionSettlement(
  row: ActionLogRow,
  settlement: ActionLogSettlement
): void {
  const meta = {
    actionRunId: row.id,
    workflowRunId: row.runId,
    actionKind: row.actionType,
  };
  // lastError is scrubbed upstream (scrubProviderError); cap its length here.
  const reason = settlement.lastError?.slice(0, MAX_REASON_LENGTH);
  switch (settlement.status) {
    case WorkflowActionRunStatus.Succeeded:
      log.info("workflow.action.succeeded", meta);
      break;
    case WorkflowActionRunStatus.Skipped:
      log.info("workflow.action.skipped", { ...meta, reason });
      break;
    case WorkflowActionRunStatus.Failed:
      log.warn("workflow.action.failed", { ...meta, reason });
      break;
    case WorkflowActionRunStatus.Pending:
      log.warn("workflow.action.retry_scheduled", {
        ...meta,
        reason,
        nextAttemptAt: settlement.nextAttemptAt?.toISOString(),
      });
      break;
    default:
      break;
  }
}

const MAX_REASON_LENGTH = 200;
