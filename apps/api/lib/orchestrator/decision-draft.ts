import {
  type OrchestratorDecisionDraft,
  type OrchestratorDecisionDraftResult,
  OrchestratorDraftOutcome,
  orchestratorDecisionDraftSchema,
} from "@repo/api/src/types/orchestrator";
import { z } from "zod";

/**
 * The draft a request_decision stores (docs/orchestrator.md): what the server
 * carries out, exactly once, when the decision is approved. The turn that
 * asked is kept so the draft runs with that turn's grants and features.
 */
export const storedDecisionDraftSchema = orchestratorDecisionDraftSchema.extend(
  { turnId: z.uuid() }
);
export type StoredDecisionDraft = z.infer<typeof storedDecisionDraftSchema>;

export function readStoredDraft(value: unknown): StoredDecisionDraft | null {
  const parsed = storedDecisionDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** One or two sentences for the wake message and tool outputs. */
export function draftResultNote(
  draft: OrchestratorDecisionDraft,
  result: OrchestratorDecisionDraftResult
): string {
  if (result.outcome === OrchestratorDraftOutcome.Running) {
    return `The approved draft on ${draft.itemKey} is being carried out; do not post it.`;
  }
  if (result.outcome === OrchestratorDraftOutcome.Done) {
    return doneNote(draft, result);
  }
  return failedNote(draft, result);
}

function doneNote(
  draft: OrchestratorDecisionDraft,
  result: OrchestratorDecisionDraftResult
): string {
  const parts = doneParts(draft, result);
  const what = parts.length > 0 ? parts.join("; ") : "nothing to do";
  return `AgentFlow carried out the approved draft on ${draft.itemKey}: ${what}. Do not post or move it again.`;
}

function failedNote(
  draft: OrchestratorDecisionDraft,
  result: OrchestratorDecisionDraftResult
): string {
  const before = doneParts(draft, result);
  const doneSoFar =
    before.length > 0 ? ` Done before it: ${before.join("; ")}.` : "";
  const keep = result.commentRef
    ? " The comment is already posted: do not post it again."
    : "";
  return `AgentFlow could not carry out the approved draft on ${draft.itemKey}: ${result.error ?? "unknown error"}.${doneSoFar}${keep} Nothing else was done; tell people or ask again.`;
}

function doneParts(
  draft: OrchestratorDecisionDraft,
  result: OrchestratorDecisionDraftResult
): string[] {
  const parts: string[] = [];
  if (result.commentRef !== null) {
    parts.push(`posted the comment (reference ${result.commentRef})`);
  }
  if (result.transition) {
    const target = result.transition.to ?? draft.transitionName;
    parts.push(
      target ? `moved ${draft.itemKey} to ${target}` : `moved ${draft.itemKey}`
    );
  }
  return parts;
}
