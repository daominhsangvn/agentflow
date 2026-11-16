import { randomUUID } from "node:crypto";
import type { JsonObject } from "@repo/api/src/types/common";
import {
  ORCHESTRATOR_CASE_MESSAGE_MAX,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { z } from "zod";
import {
  postTeamsAskThreadReply,
  TEAMS_ASK_BODY_MAX_LENGTH,
} from "@/lib/integrations/providers/microsoft-teams/channel-ask";
import { readTaskResult } from "@/lib/orchestrator/task-result";
import type {
  TeamsAskPayload,
  TeamsAskSummaryEntry,
} from "@/lib/orchestrator/teams-ask";
import {
  loadTeamsAskChannels,
  resolveTeamsAskChannel,
  type TeamsAskChannelOption,
} from "@/lib/orchestrator/teams-ask-channels";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import {
  REPLY_MAX,
  TEAMS_ASK_MENTIONS_MAX,
  TEAMS_ASK_QUESTIONS_MAX,
} from "./limits";
import { findServiceUrl, loadTeams } from "./teams-ask";
import { findTeamsAskPost } from "./teams-ask-post";
import {
  notGranted,
  refused,
  type ToolOutcome,
  type TurnContext,
} from "./turn";

/** teams_ask_reply: write in an existing teams_ask thread, optionally with answers to confirm. */

const LOG_PREFIX = "[orchestrator-tools]";

export const teamsAskReplyInputSchema = z.object({
  askRef: z.string().trim().min(1).max(255),
  text: z.string().trim().min(1).max(REPLY_MAX),
  mentions: z
    .array(z.email().transform((email) => email.trim().toLowerCase()))
    .max(TEAMS_ASK_MENTIONS_MAX)
    .default([])
    .transform((emails) => [...new Set(emails)]),
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(255),
        answer: z.string().trim().min(1).max(ORCHESTRATOR_CASE_MESSAGE_MAX),
      })
    )
    .min(1)
    .max(TEAMS_ASK_QUESTIONS_MAX)
    .optional(),
});
export type TeamsAskReplyInput = z.infer<typeof teamsAskReplyInputSchema>;

type Refusal = { reason: string; outcome: ToolOutcome };
type Prepared = {
  ask: TeamsAskPayload;
  channel: TeamsAskChannelOption;
  summary: TeamsAskSummaryEntry[] | null;
  body: string;
  emails: string[];
};

export function replyInTeamsAsk(
  context: TurnContext,
  input: TeamsAskReplyInput
): Promise<ToolOutcome> {
  return withSpan(
    "orchestrator.teams_ask_reply",
    {
      [AfAttribute.OrgId]: context.organizationId,
      [AfAttribute.CaseId]: context.caseId,
      [AfAttribute.ConversationId]: context.conversationId,
      [AfAttribute.TurnId]: context.turnId,
    },
    async (span) => {
      const prepared = await prepareReply(context, input);
      if (!prepared.ok) {
        setSpanOutcome(AfOutcome.Rejected, prepared.error.reason, span);
        return prepared.error.outcome;
      }
      const { ask, channel, summary, body, emails } = prepared.value;
      const teams = await loadTeams(context.organizationId, channel);
      if (!teams.ok) {
        setSpanOutcome(AfOutcome.Rejected, "connection_not_loaded", span);
        return refused(teams.error);
      }
      const serviceUrl = await findServiceUrl(
        context.organizationId,
        teams.value.connectionId
      );
      // A summary is stored before it is posted, so every summary visible in
      // Teams has a row and a confirmation can never match an older one.
      const record = {
        askRef: input.askRef,
        body,
        mentions: ask.mentions,
        summary,
      };
      const storedId = summary ? await storeSummary(context, record) : null;
      if (summary && !storedId) {
        setSpanOutcome(AfOutcome.Error, "teams_ask_summary_not_stored", span);
        return {
          ok: false,
          error:
            "The summary could not be stored, so nothing was posted: try again.",
          retryable: true,
        };
      }
      const posted = await postTeamsAskThreadReply(teams.value.context, {
        serviceUrl,
        channelId: ask.channelId,
        rootMessageId: input.askRef,
        emails,
        known: ask.mentions,
        text: body,
      });
      if (!posted.ok) {
        setSpanOutcome(AfOutcome.Error, "teams_post_failed", span);
        if (storedId) {
          await discardSummary(context, storedId);
        }
        return {
          ok: false,
          error: scrubProviderError(posted.error.error, teams.value.secrets),
          retryable: posted.error.retryable,
        };
      }
      const recorded = storedId
        ? await completeSummary(context, storedId, record, posted.value)
        : await recordReplySafely(context, {
            ...record,
            messageId: posted.value.messageId,
            mentions: posted.value.mentions,
          });
      return {
        ok: true,
        output: replyOutput(input.askRef, posted.value, summary, recorded),
      };
    }
  );
}

async function prepareReply(
  context: TurnContext,
  input: TeamsAskReplyInput
): Promise<Result<Prepared, Refusal>> {
  if (context.grants.ask.size === 0) {
    return refusal("not_granted", notGranted("<teams connection key>: ask"));
  }
  const found = await findTeamsAskPost(context, input.askRef);
  if (!found) {
    return refusal(
      "ask_not_found",
      refused(
        "askRef: not a teams_ask post of this conversation (use the reference teams_ask returned)."
      )
    );
  }
  const { ask } = found;
  if (ask.connectionKey && !context.grants.ask.has(ask.connectionKey)) {
    return refusal("not_granted", notGranted(`${ask.connectionKey}: ask`));
  }
  const options = await loadTeamsAskChannels(
    context.organizationId,
    context.projectId,
    context.grants.ask
  );
  const chosen = resolveTeamsAskChannel(options, {
    channel: ask.channelId,
    connection: ask.connectionKey,
  });
  if (!chosen.ok) {
    return refusal(
      "ask_channel_not_allowed",
      refused("The ask's channel is no longer an allowed ask channel.")
    );
  }
  const summary = await buildSummary(context, ask, input.answers);
  if (!summary.ok) {
    return summary;
  }
  const body = buildBody(input.text, summary.value, ask);
  if (body.length > TEAMS_ASK_BODY_MAX_LENGTH) {
    return refusal(
      "too_long",
      refused("Too long for Teams: shorten the answers.")
    );
  }
  const emails =
    input.mentions.length === 0 && summary.value
      ? ask.mentions.map((mention) => mention.email)
      : input.mentions;
  return Result.ok({
    ask,
    channel: chosen.value,
    summary: summary.value,
    body,
    emails,
  });
}

/** The answers with their question texts, null when the post has no answers. */
async function buildSummary(
  context: TurnContext,
  ask: TeamsAskPayload,
  answers: TeamsAskReplyInput["answers"]
): Promise<Result<TeamsAskSummaryEntry[] | null, Refusal>> {
  if (!answers) {
    return Result.ok(null);
  }
  const first = ask.questions[0];
  if (!first) {
    return refusal(
      "no_questions",
      refused("This ask relayed no task questions: post without answers.")
    );
  }
  const asked = ask.questions.map((question) => question.questionId);
  const ids = answers.map((answer) => answer.questionId);
  if (new Set(ids).size !== ids.length) {
    return refusal(
      "duplicate_question",
      refused("answers: one answer per questionId.")
    );
  }
  const unknown = ids.filter((id) => !asked.includes(id));
  if (unknown.length > 0) {
    return refusal(
      "unknown_question",
      refused(
        `answers: unknown question id ${unknown.join(", ")}; the ask relayed: ${asked.join(", ")}.`
      )
    );
  }
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: {
        id: first.taskId,
        caseId: context.caseId,
        organizationId: context.organizationId,
      },
      select: { result: true },
    })
  );
  const texts = new Map(
    (readTaskResult(task?.result)?.questions ?? []).map((question) => [
      question.id,
      question.question,
    ])
  );
  return Result.ok(
    answers.map((answer) => ({
      taskId: first.taskId,
      questionId: answer.questionId,
      question: texts.get(answer.questionId) ?? answer.questionId,
      answer: answer.answer,
    }))
  );
}

function buildBody(
  text: string,
  summary: TeamsAskSummaryEntry[] | null,
  ask: TeamsAskPayload
): string {
  if (!summary) {
    return text;
  }
  const lines = summary.map((entry) => `- ${entry.question} → ${entry.answer}`);
  const names = ask.mentions.map((mention) => mention.name).join(", ");
  return `${text}\n\n**Answers to confirm:**\n${lines.join("\n")}\n\n${names}: reply here and @mention me to confirm, or correct them.`;
}

type ReplyRecord = {
  askRef: string;
  body: string;
  messageId?: string | null;
  mentions: TeamsAskPayload["mentions"];
  summary: TeamsAskSummaryEntry[] | null;
};

async function recordReplySafely(
  context: TurnContext,
  record: ReplyRecord
): Promise<boolean> {
  try {
    await createReplyRow(context, record, record.messageId ?? randomUUID());
    return true;
  } catch (error) {
    setSpanOutcome(AfOutcome.Error, "teams_ask_reply_not_recorded");
    log.error(`${LOG_PREFIX} teams_ask_reply posted but not recorded`, {
      reason: "teams_ask_reply_not_recorded",
      ...replyLogScope(context, record),
      error,
    });
    return false;
  }
}

function createReplyRow(
  context: TurnContext,
  record: ReplyRecord,
  dedupSuffix: string
): Promise<{ id: string }> {
  return withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        actor: null,
        text: record.body,
        externalRef: record.messageId ?? null,
        dedupKey: `teams_ask_reply:${context.turnId}:${dedupSuffix}`,
        turnId: context.turnId,
        payload: {
          via: OrchestratorMessageVia.Teams,
          teamsAskReply: {
            askRef: record.askRef,
            mentions: record.mentions,
            summary: record.summary,
          },
        },
      },
      select: { id: true },
    })
  );
}

function replyLogScope(context: TurnContext, record: { askRef: string }) {
  return {
    organizationId: context.organizationId,
    caseId: context.caseId,
    conversationId: context.conversationId,
    turnId: context.turnId,
    askRef: record.askRef,
  };
}

/** Stores the summary before it is posted; null when it could not be stored. */
async function storeSummary(
  context: TurnContext,
  record: ReplyRecord
): Promise<string | null> {
  try {
    const created = await createReplyRow(context, record, randomUUID());
    return created.id;
  } catch (error) {
    log.error(`${LOG_PREFIX} teams_ask_reply summary not stored`, {
      reason: "teams_ask_summary_not_stored",
      ...replyLogScope(context, record),
      error,
    });
    return null;
  }
}

/** Removes a stored summary whose Teams post failed, so it cannot be confirmed. */
async function discardSummary(
  context: TurnContext,
  messageId: string
): Promise<void> {
  try {
    await withDb((db) =>
      db.orchestratorMessage.deleteMany({
        where: { id: messageId, organizationId: context.organizationId },
      })
    );
  } catch (error) {
    setSpanOutcome(AfOutcome.Error, "teams_ask_summary_not_discarded");
    log.error(`${LOG_PREFIX} teams_ask_reply summary not discarded`, {
      reason: "teams_ask_summary_not_discarded",
      organizationId: context.organizationId,
      caseId: context.caseId,
      conversationId: context.conversationId,
      turnId: context.turnId,
      messageId,
      error,
    });
  }
}

/** Points the stored summary at the Teams message that was posted. */
async function completeSummary(
  context: TurnContext,
  storedId: string,
  record: ReplyRecord,
  posted: { messageId: string | null; mentions: TeamsAskPayload["mentions"] }
): Promise<boolean> {
  try {
    await withDb((db) =>
      db.orchestratorMessage.updateMany({
        where: { id: storedId, organizationId: context.organizationId },
        data: {
          externalRef: posted.messageId,
          payload: {
            via: OrchestratorMessageVia.Teams,
            teamsAskReply: {
              askRef: record.askRef,
              mentions: posted.mentions,
              summary: record.summary,
            },
          },
        },
      })
    );
    return true;
  } catch (error) {
    // The summary is stored and confirmable; only the Teams message id is missing.
    setSpanOutcome(AfOutcome.Error, "teams_ask_reply_ref_not_updated");
    log.warn(
      `${LOG_PREFIX} teams_ask_reply posted but its reference was not stored`,
      {
        reason: "teams_ask_reply_ref_not_updated",
        ...replyLogScope(context, record),
        error,
      }
    );
    return true;
  }
}

function replyOutput(
  askRef: string,
  posted: { messageId: string | null; mentions: TeamsAskPayload["mentions"] },
  summary: TeamsAskSummaryEntry[] | null,
  recorded: boolean
): JsonObject {
  return {
    posted: true,
    reference: posted.messageId,
    askRef,
    mentioned: posted.mentions.map((mention) => mention.name),
    awaitingConfirmation: summary !== null,
    ...(recorded ? {} : { recorded: false }),
    ...(!recorded && summary
      ? {
          next: "The summary was not recorded, so it cannot be confirmed: post it again.",
        }
      : {}),
  };
}

function refusal(reason: string, outcome: ToolOutcome): Result<never, Refusal> {
  return Result.err({ reason, outcome });
}
