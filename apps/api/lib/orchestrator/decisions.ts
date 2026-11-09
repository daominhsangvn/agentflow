import {
  type OrchestratorDecisionDraftResult,
  OrchestratorDecisionStatus,
  type OrchestratorDecisionVia,
  OrchestratorDraftOutcome,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import {
  draftResultNote,
  readStoredDraft,
  type StoredDecisionDraft,
} from "@/lib/orchestrator/decision-draft";

/**
 * Decisions the orchestrator asks people for (docs/orchestrator.md): an
 * approval of a plan, a go for an implementation. An admin decides with the
 * button in AgentFlow, or someone says it in the thread and the orchestrator
 * records it. Either way the decision is taken once, and an internal message
 * wakes the conversation that asked.
 */

const QUESTION_MAX = 4000;
const COMMENT_MAX = 4000;

export async function requestDecision(input: {
  organizationId: string;
  caseId: string;
  conversationId: string;
  question: string;
  draft: StoredDecisionDraft | null;
}): Promise<string> {
  const decision = await withDb((db) =>
    db.orchestratorDecision.create({
      data: {
        organizationId: input.organizationId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        question: input.question.slice(0, QUESTION_MAX),
        ...(input.draft ? { draft: input.draft } : {}),
      },
      select: { id: true },
    })
  );
  return decision.id;
}

export type DecideInput = {
  organizationId: string;
  decisionId: string;
  approved: boolean;
  comment: string | null;
  via: OrchestratorDecisionVia;
  /** Who decided: their name as shown, and their user id when in AgentFlow. */
  decidedBy: string;
  decidedById: string | null;
  /** Limits the decision to one case (the orchestrator's own case). */
  caseId?: string;
  /**
   * Wake the conversation with the decision (false when the orchestrator
   * records one it was told in the running turn: it knows already).
   */
  notify?: boolean;
  /** Refuse (Forbidden) to approve a decision that carries a draft: only the button may. */
  refuseDraftApproval?: boolean;
  /** Carries out the stored draft of an approved decision (not in a transaction). */
  carryOut?: (decision: {
    id: string;
    conversationId: string;
    caseId: string;
    draft: StoredDecisionDraft;
  }) => Promise<OrchestratorDecisionDraftResult>;
};

export type DecideOutcome = {
  conversationId: string;
  draftResult: OrchestratorDecisionDraftResult | null;
  draftNote: string | null;
};

/** Takes the decision once; NotFound for a decision that is not pending. */
export async function decide(
  input: DecideInput,
  now: Date = new Date()
): Promise<Result<DecideOutcome, StatusCode>> {
  const decision = await withDb((db) =>
    db.orchestratorDecision.findFirst({
      where: {
        id: input.decisionId,
        organizationId: input.organizationId,
        status: OrchestratorDecisionStatus.Pending,
        ...(input.caseId ? { caseId: input.caseId } : {}),
      },
      select: {
        id: true,
        conversationId: true,
        caseId: true,
        question: true,
        draft: true,
      },
    })
  );
  if (!decision) {
    return Result.err(Status.NotFound);
  }
  const draft = input.approved ? readStoredDraft(decision.draft) : null;
  if (draft && input.refuseDraftApproval) {
    return Result.err(Status.Forbidden);
  }
  if (draft && input.carryOut) {
    return await decideWithDraft(input, decision, draft, input.carryOut, now);
  }
  const status = decisionStatus(input);
  const comment = decisionComment(input);
  const taken = await withDb.tx(async (tx) => {
    const updated = await tx.orchestratorDecision.updateMany({
      where: { id: decision.id, status: OrchestratorDecisionStatus.Pending },
      data: decisionFields(input, status, comment, now),
    });
    if (updated.count !== 1) {
      return false;
    }
    if (input.notify === false) {
      return true;
    }
    await announce(tx, input, decision, status, comment, now, null);
    return true;
  });
  return taken
    ? Result.ok({
        conversationId: decision.conversationId,
        draftResult: null,
        draftNote: null,
      })
    : Result.err(Status.NotFound);
}

type DecisionRow = {
  id: string;
  conversationId: string;
  caseId: string;
  question: string;
};

type Tx = Parameters<Parameters<typeof withDb.tx>[0]>[0];

/**
 * Approval with a draft: claim the decision (and mark the draft running) in
 * one transaction, carry it out outside any transaction, then record the
 * result and wake the orchestrator with it.
 */
async function decideWithDraft(
  input: DecideInput,
  decision: DecisionRow,
  draft: StoredDecisionDraft,
  carryOut: NonNullable<DecideInput["carryOut"]>,
  now: Date
): Promise<Result<DecideOutcome, StatusCode>> {
  const status = OrchestratorDecisionStatus.Approved;
  const comment = decisionComment(input);
  const running: OrchestratorDecisionDraftResult = {
    outcome: OrchestratorDraftOutcome.Running,
    commentRef: null,
    transition: null,
    error: null,
    carriedOutAt: now.toISOString(),
  };
  const claimed = await withDb.tx(async (tx) => {
    const updated = await tx.orchestratorDecision.updateMany({
      where: { id: decision.id, status: OrchestratorDecisionStatus.Pending },
      data: {
        ...decisionFields(input, status, comment, now),
        draftResult: running,
      },
    });
    return updated.count === 1;
  });
  if (!claimed) {
    return Result.err(Status.NotFound);
  }
  const result = await runCarryOut(carryOut, decision, draft, now);
  const note = draftResultNote(draft, result);
  await withDb.tx(async (tx) => {
    await tx.orchestratorDecision.updateMany({
      where: { id: decision.id, status: OrchestratorDecisionStatus.Approved },
      data: { draftResult: result },
    });
    if (input.notify !== false) {
      await announce(tx, input, decision, status, comment, now, note);
    }
  });
  return Result.ok({
    conversationId: decision.conversationId,
    draftResult: result,
    draftNote: note,
  });
}

async function runCarryOut(
  carryOut: NonNullable<DecideInput["carryOut"]>,
  decision: DecisionRow,
  draft: StoredDecisionDraft,
  now: Date
): Promise<OrchestratorDecisionDraftResult> {
  try {
    return await carryOut({
      id: decision.id,
      conversationId: decision.conversationId,
      caseId: decision.caseId,
      draft,
    });
  } catch (error) {
    return {
      outcome: OrchestratorDraftOutcome.Failed,
      commentRef: null,
      transition: null,
      error: error instanceof Error ? error.message : String(error),
      carriedOutAt: now.toISOString(),
    };
  }
}

function decisionStatus(input: DecideInput) {
  return input.approved
    ? OrchestratorDecisionStatus.Approved
    : OrchestratorDecisionStatus.Rejected;
}

function decisionComment(input: DecideInput): string | null {
  return input.comment?.trim().slice(0, COMMENT_MAX) || null;
}

function decisionFields(
  input: DecideInput,
  status: OrchestratorDecisionStatus,
  comment: string | null,
  now: Date
) {
  return {
    status,
    via: input.via,
    decidedBy: input.decidedBy.slice(0, 255),
    decidedById: input.decidedById,
    comment,
    decidedAt: now,
  };
}

/** The Decision message that wakes the conversation that asked. */
async function announce(
  tx: Tx,
  input: DecideInput,
  decision: DecisionRow,
  status: OrchestratorDecisionStatus,
  comment: string | null,
  now: Date,
  draftNote: string | null
): Promise<void> {
  const base = `Decision ${decision.id} was ${status} by ${input.decidedBy} (${input.via})${comment ? `: ${comment}` : "."}\nIt asked: ${decision.question}`;
  await tx.orchestratorMessage.create({
    data: {
      organizationId: input.organizationId,
      conversationId: decision.conversationId,
      origin: OrchestratorMessageOrigin.Internal,
      kind: OrchestratorMessageKind.Decision,
      actor: input.decidedBy.slice(0, 255),
      text: draftNote ? `${base}\n${draftNote}` : base,
      dedupKey: `decision:${decision.id}`,
      payload: { decisionId: decision.id, status, via: input.via },
    },
  });
  await tx.orchestratorConversation.update({
    where: { id: decision.conversationId },
    data: { nextWakeAt: now },
  });
}
