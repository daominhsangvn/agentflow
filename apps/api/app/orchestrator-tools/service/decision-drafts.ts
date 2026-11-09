import { SourceOperation } from "@repo/api/src/types/connection-grants";
import {
  type OrchestratorDecisionDraftResult,
  OrchestratorDraftOutcome,
  OrchestratorReplyTarget,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { z } from "zod";
import { sourceGrantDefinitions } from "@/lib/integrations/connection-grants";
import type { StoredDecisionDraft } from "@/lib/orchestrator/decision-draft";
import {
  findCaseTaskFiles,
  taskFileRefSchema,
} from "@/lib/orchestrator/task-files";
import { loadOrchestratorWorkflows } from "@/lib/orchestrator/workflow-settings";
import { REPLY_ATTACHMENTS_MAX } from "./attachments";
import { REPLY_MAX } from "./limits";
import { reply } from "./replies";
import { sourceTransitionInputSchema, writeOnItem } from "./source-writes";
import { replyThread } from "./threads";
import {
  loadConversationConnection,
  notGranted,
  type ToolOutcome,
  type TurnContext,
  turnContextOf,
} from "./turn";

/**
 * The draft a request_decision carries (docs/orchestrator.md): checked when
 * asked, so a bad draft never reaches a person, and carried out by the server
 * when an admin approves it.
 */

export const decisionDraftInputSchema = z
  .object({
    comment: z
      .object({
        text: z.string().trim().min(1).max(REPLY_MAX),
        replyTo: z.string().trim().min(1).max(255).optional(),
        attachments: z
          .array(taskFileRefSchema)
          .max(REPLY_ATTACHMENTS_MAX)
          .default([]),
      })
      .optional(),
    transitionName: sourceTransitionInputSchema.shape.transitionName.optional(),
  })
  .refine((d) => d.comment !== undefined || d.transitionName !== undefined, {
    message: "A draft needs a comment or a transitionName",
  });
export type DecisionDraftInput = z.infer<typeof decisionDraftInputSchema>;

type DraftComment = NonNullable<DecisionDraftInput["comment"]>;

const referenceSchema = z.object({ reference: z.string().nullable() });
const movedSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});

export async function prepareDecisionDraft(
  context: TurnContext,
  input: DecisionDraftInput
): Promise<Result<StoredDecisionDraft, string>> {
  const channel = context.channel;
  if (!channel) {
    return Result.err(
      "This conversation has no item: a draft acts on the conversation's item."
    );
  }
  const { comment, transitionName } = input;
  if (comment) {
    const problem = await checkComment(context, comment);
    if (problem) {
      return Result.err(problem);
    }
  }
  if (transitionName !== undefined) {
    const problem = await checkTransition(context, channel.item.provider);
    if (problem) {
      return Result.err(problem);
    }
  }
  return Result.ok({
    turnId: context.turnId,
    itemKey: channel.item.key,
    comment: comment
      ? {
          text: comment.text,
          replyTo: comment.replyTo ?? null,
          attachments: comment.attachments,
        }
      : null,
    transitionName: transitionName ?? null,
  });
}

export async function carryOutDecisionDraft(
  organizationId: string,
  decision: {
    id: string;
    conversationId: string;
    caseId: string;
    draft: StoredDecisionDraft;
  }
): Promise<OrchestratorDecisionDraftResult> {
  const { draft } = decision;
  const context = await draftContext(organizationId, decision);
  if (!context) {
    return failed("The case's workflow is not orchestrated any more.", null);
  }
  let commentRef: string | null = null;
  if (draft.comment) {
    const posted = await reply(
      context,
      draft.comment.text,
      draft.comment.attachments,
      draft.comment.replyTo ?? undefined,
      OrchestratorReplyTarget.Thread
    );
    if (!posted.ok) {
      return failed(posted.error, null);
    }
    const parsed = referenceSchema.safeParse(posted.output);
    commentRef = parsed.success ? parsed.data.reference : null;
  }
  if (draft.transitionName === null) {
    return finished(commentRef, null);
  }
  // The comment may already be on the item: a thrown move must keep its
  // reference, or the orchestrator would be invited to post it again.
  let moved: Awaited<ReturnType<typeof writeOnItem>>;
  try {
    moved = await writeOnItem(context, {
      op: SourceOperation.Transition,
      transitionName: draft.transitionName,
    });
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : String(error),
      commentRef
    );
  }
  if (!moved.ok) {
    return failed(moved.error, commentRef);
  }
  const change = movedSchema.safeParse(moved.output);
  return finished(
    commentRef,
    change.success ? change.data : { from: null, to: draft.transitionName }
  );
}

async function checkComment(
  context: TurnContext,
  comment: DraftComment
): Promise<string | null> {
  if (!context.grants.source.has(OrchestratorSourceOperation.Comment)) {
    return refusal(notGranted("source: comment"));
  }
  const connection = await loadConversationConnection(context);
  if (!connection?.provider.replyOnItem) {
    return "This conversation has no thread AgentFlow can post in.";
  }
  if (
    comment.replyTo !== undefined &&
    (await replyThread(context.conversationId, comment.replyTo)) === null
  ) {
    return `replyTo: ${comment.replyTo} is not a message of this conversation (use the ref of a <message> you were given).`;
  }
  if (comment.attachments.length === 0) {
    return null;
  }
  if (!context.grants.source.has(OrchestratorSourceOperation.Attach)) {
    return refusal(notGranted("source: attach"));
  }
  if (!connection.provider.source?.attachFile) {
    return "This conversation's thread takes no files: draft the comment without attachments and name the files instead.";
  }
  const files = await findCaseTaskFiles(context.caseId, comment.attachments);
  return files.ok ? null : files.error;
}

async function checkTransition(
  context: TurnContext,
  provider: string
): Promise<string | null> {
  if (!context.grants.source.has(OrchestratorSourceOperation.Transition)) {
    return refusal(notGranted("source: transition"));
  }
  if (!(await loadConversationConnection(context))) {
    return "This conversation has no item AgentFlow can change.";
  }
  if (
    sourceGrantDefinitions(provider, [SourceOperation.Transition]).length === 0
  ) {
    return `This conversation's item (${provider}) cannot ${SourceOperation.Transition}.`;
  }
  return null;
}

async function draftContext(
  organizationId: string,
  decision: { conversationId: string; draft: StoredDecisionDraft }
): Promise<TurnContext | null> {
  const conversation = await withDb((db) =>
    db.orchestratorConversation.findFirst({
      where: { id: decision.conversationId, organizationId },
      select: {
        id: true,
        projectId: true,
        caseId: true,
        projectConnectionId: true,
        channel: true,
        case: { select: { workflowId: true } },
      },
    })
  );
  if (!conversation) {
    return null;
  }
  const workflows = await loadOrchestratorWorkflows(organizationId, [
    conversation.case.workflowId,
  ]);
  const workflow = workflows.get(conversation.case.workflowId);
  if (!workflow) {
    return null;
  }
  return turnContextOf(
    { id: decision.draft.turnId, organizationId },
    conversation,
    workflow
  );
}

function refusal(outcome: ToolOutcome): string {
  return outcome.ok ? "" : outcome.error;
}

function failed(
  error: string,
  commentRef: string | null
): OrchestratorDecisionDraftResult {
  return {
    outcome: OrchestratorDraftOutcome.Failed,
    commentRef,
    transition: null,
    error,
    carriedOutAt: new Date().toISOString(),
  };
}

function finished(
  commentRef: string | null,
  transition: { from: string | null; to: string | null } | null
): OrchestratorDecisionDraftResult {
  return {
    outcome: OrchestratorDraftOutcome.Done,
    commentRef,
    transition,
    error: null,
    carriedOutAt: new Date().toISOString(),
  };
}
