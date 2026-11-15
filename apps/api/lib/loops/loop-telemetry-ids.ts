import { withDb } from "@repo/database";
import { AfAttribute } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import type { SpanAttributes } from "@repo/observability/span";

/**
 * Ids a loop belongs to (orchestrator task/case/turn/project, workflow run)
 * for the active span. Fail-open: telemetry never blocks a launch.
 */
export async function resolveLoopTelemetryIds(
  loopId: string
): Promise<SpanAttributes> {
  try {
    const [task, workflowRunLoop] = await withDb((db) =>
      Promise.all([
        db.orchestratorTask.findUnique({
          where: { loopId },
          select: {
            id: true,
            caseId: true,
            turnId: true,
            case: { select: { projectId: true } },
          },
        }),
        db.workflowRunLoop.findUnique({
          where: { loopId },
          select: { runId: true },
        }),
      ])
    );
    const attributes: SpanAttributes = {};
    if (task) {
      attributes[AfAttribute.TaskId] = task.id;
      attributes[AfAttribute.CaseId] = task.caseId;
      if (task.turnId) {
        attributes[AfAttribute.TurnId] = task.turnId;
      }
      if (task.case?.projectId) {
        attributes[AfAttribute.ProjectId] = task.case.projectId;
      }
    }
    if (workflowRunLoop) {
      attributes[AfAttribute.WorkflowRunId] = workflowRunLoop.runId;
    }
    return attributes;
  } catch (error) {
    log.debug("loop.telemetry_ids_unavailable", { loopId, error });
    return {};
  }
}
