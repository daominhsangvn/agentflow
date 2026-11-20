import {
  IntegrationToolCallStatus,
  IntegrationToolName,
} from "@repo/api/src/types/integration-tools";
import { WorkflowActionRunStatus } from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";
import { JiraActionType } from "@/lib/integrations/providers/jira/constants";
import type { EngineRun } from "./step-outcome";

/**
 * The ids of the comments the run posted on its source item: through the
 * comment tool (instruction actions and agent steps) and through Jira comment
 * actions.
 */
export async function readRunCommentIds(
  run: Pick<EngineRun, "id" | "organizationId">
): Promise<ReadonlySet<string>> {
  const [calls, actionRuns] = await Promise.all([
    withDb((db) =>
      db.integrationToolCall.findMany({
        where: {
          runId: run.id,
          organizationId: run.organizationId,
          tool: IntegrationToolName.SourceItemComment,
          status: IntegrationToolCallStatus.Succeeded,
          externalRef: { not: null },
        },
        select: { externalRef: true },
      })
    ),
    withDb((db) =>
      db.workflowActionRun.findMany({
        where: {
          runId: run.id,
          organizationId: run.organizationId,
          actionType: JiraActionType.AddComment,
          status: WorkflowActionRunStatus.Succeeded,
          externalRef: { not: null },
        },
        select: { externalRef: true },
      })
    ),
  ]);
  return new Set(
    [...calls, ...actionRuns].flatMap((row) =>
      row.externalRef ? [row.externalRef] : []
    )
  );
}
