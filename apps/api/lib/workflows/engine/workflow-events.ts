import { WorkflowEventResult } from "@repo/api/src/types/workflow-event";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import type { OrchestratorRouteResult } from "@/lib/orchestrator/inbound";

/**
 * Per-workflow event log (docs/workflows.md "Ingest"): what ingest did with an
 * inbound event for each workflow it concerns. Best effort: a failure to
 * record is logged and never fails ingest.
 */

const TRIGGER_TYPE_MAX_LENGTH = 64;
const SOURCE_KEY_MAX_LENGTH = 255;
const DETAIL_MAX_LENGTH = 1000;

export type WorkflowEventDraft = {
  workflowId: string;
  triggerId: string | null;
  triggerType: string;
  sourceKey: string | null;
  result: WorkflowEventResult;
  runId: string | null;
  caseId: string | null;
  detail: string | null;
  occurredAt: Date | null;
};

export type EventFacts = {
  triggerType: string;
  sourceKey: string;
  occurredAt: Date | null;
};

type TriggerRef = { id: string; workflowId: string };

export function runEventDraft(
  facts: EventFacts,
  target: { workflowId: string; triggerId: string | null; runId: string },
  result: WorkflowEventResult
): WorkflowEventDraft {
  return {
    workflowId: target.workflowId,
    triggerId: target.triggerId,
    triggerType: facts.triggerType,
    sourceKey: facts.sourceKey,
    result,
    runId: target.runId,
    caseId: null,
    detail: RESULT_DETAILS[result] ?? null,
    occurredAt: facts.occurredAt,
  };
}

export function orchestratedEventDrafts(
  facts: EventFacts,
  results: readonly OrchestratorRouteResult[],
  matched: readonly TriggerRef[]
): WorkflowEventDraft[] {
  return results.map((result) => ({
    workflowId: result.workflowId,
    triggerId:
      matched.find((trigger) => trigger.workflowId === result.workflowId)?.id ??
      null,
    triggerType: facts.triggerType,
    sourceKey: facts.sourceKey,
    result: result.created
      ? WorkflowEventResult.CaseMessage
      : WorkflowEventResult.Duplicate,
    runId: null,
    caseId: result.caseId,
    detail: result.created ? null : "Message already recorded",
    occurredAt: facts.occurredAt,
  }));
}

export function filteredEventDrafts(
  facts: EventFacts,
  args: {
    candidates: readonly TriggerRef[];
    matchedIds: ReadonlySet<string>;
    handledWorkflowIds: ReadonlySet<string>;
  }
): WorkflowEventDraft[] {
  const byWorkflow = new Map<string, TriggerRef[]>();
  for (const candidate of args.candidates) {
    const group = byWorkflow.get(candidate.workflowId) ?? [];
    group.push(candidate);
    byWorkflow.set(candidate.workflowId, group);
  }
  const drafts: WorkflowEventDraft[] = [];
  for (const [workflowId, group] of byWorkflow) {
    const first = group[0];
    if (
      !first ||
      args.handledWorkflowIds.has(workflowId) ||
      group.some((trigger) => args.matchedIds.has(trigger.id))
    ) {
      continue;
    }
    drafts.push({
      workflowId,
      triggerId: first.id,
      triggerType: facts.triggerType,
      sourceKey: facts.sourceKey,
      result: WorkflowEventResult.Filtered,
      runId: null,
      caseId: null,
      detail: RESULT_DETAILS[WorkflowEventResult.Filtered] ?? null,
      occurredAt: facts.occurredAt,
    });
  }
  return drafts;
}

export async function recordWorkflowEvents(input: {
  organizationId: string;
  deliveryRowId: string;
  drafts: readonly WorkflowEventDraft[];
}): Promise<void> {
  if (input.drafts.length === 0) {
    return;
  }
  try {
    const data = input.drafts.map((draft) => ({
      organizationId: input.organizationId,
      deliveryId: input.deliveryRowId,
      workflowId: draft.workflowId,
      triggerId: draft.triggerId,
      triggerType: draft.triggerType.slice(0, TRIGGER_TYPE_MAX_LENGTH),
      sourceKey: draft.sourceKey?.slice(0, SOURCE_KEY_MAX_LENGTH) ?? null,
      result: draft.result,
      runId: draft.runId,
      caseId: draft.caseId,
      detail: draft.detail?.slice(0, DETAIL_MAX_LENGTH) ?? null,
      occurredAt: draft.occurredAt,
    }));
    await withDb((db) => db.workflowEvent.createMany({ data }));
  } catch (error) {
    log.warn("[workflows/events] Could not record workflow events", {
      deliveryRowId: input.deliveryRowId,
      count: input.drafts.length,
      error,
    });
  }
}

const RESULT_DETAILS: Partial<Record<WorkflowEventResult, string>> = {
  [WorkflowEventResult.Duplicate]: "Occurrence already handled",
  [WorkflowEventResult.Active]: "Run already active",
  [WorkflowEventResult.Signaled]: "Taken as a review or approval signal",
  [WorkflowEventResult.Replied]: "A reply to the run's questions resumed it",
  [WorkflowEventResult.Filtered]: "Trigger filters did not match",
};
