import type { JsonObject } from "@repo/api/src/types/common";
import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import {
  setActiveSpanAttributes,
  setSpanOutcome,
  withSpan,
} from "@repo/observability/span";
import { z } from "zod";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { coverTaskQuestions } from "@/lib/orchestrator/cover-questions";
import {
  askThreadRef,
  isAskedPerson,
  readTeamsAskReply,
  readTeamsAskThread,
  type TeamsAskPayload,
  type TeamsAskSummaryEntry,
} from "@/lib/orchestrator/teams-ask";
import { caseConversationIds } from "@/lib/orchestrator/teams-ask-threads";
import { findTeamsAskPost } from "./teams-ask-post";
import {
  notGranted,
  refused,
  type ToolOutcome,
  type TurnContext,
} from "./turn";

/** teams_ask_confirm: record the answers of the latest summary once an asked person confirmed it. */

const PRISMA_UNIQUE_VIOLATION = "P2002";
const SUMMARIES_SCANNED = 20;
const NOT_GRANTED_REASON = "ask_not_granted";

export const teamsAskConfirmInputSchema = z.object({
  askRef: z.string().trim().min(1).max(255),
  confirmationRef: z.string().trim().min(1).max(255),
});
export type TeamsAskConfirmInput = z.infer<typeof teamsAskConfirmInputSchema>;

export const TeamsAskConfirmRefusal = {
  AskNotFound: "ask_not_found",
  SummaryMissing: "summary_missing",
  ConfirmationNotFound: "confirmation_not_found",
  OtherThread: "confirmation_other_thread",
  BeforeSummary: "confirmation_before_summary",
  OtherAskSummary: "confirmation_other_ask_summary",
  NotAsked: "confirmer_not_asked",
} as const;
export type TeamsAskConfirmRefusal =
  (typeof TeamsAskConfirmRefusal)[keyof typeof TeamsAskConfirmRefusal];

type Summary = { id: string; createdAt: Date; entries: TeamsAskSummaryEntry[] };
type Confirmation = {
  id: string;
  createdAt: Date;
  actor: string | null;
  actorId: string | null;
  askRef: string | null;
  threadRef: string | null;
};
type Checked = {
  ask: TeamsAskPayload;
  summary: Summary;
  confirmation: Confirmation;
};
type Guard =
  | { ok: true; checked: Checked }
  | { ok: false; reason: string; message: string };

export function confirmTeamsAskAnswers(
  context: TurnContext,
  input: TeamsAskConfirmInput
): Promise<ToolOutcome> {
  return withSpan(
    "orchestrator.teams_ask_confirm",
    {
      [AfAttribute.OrgId]: context.organizationId,
      [AfAttribute.CaseId]: context.caseId,
      [AfAttribute.ConversationId]: context.conversationId,
      [AfAttribute.TurnId]: context.turnId,
    },
    async () => {
      if (context.grants.ask.size === 0) {
        setSpanOutcome(AfOutcome.Rejected, NOT_GRANTED_REASON);
        return notGranted("<teams connection key>: ask");
      }
      const guard = await checkConfirmation(context, input);
      if (!guard.ok) {
        setSpanOutcome(AfOutcome.Rejected, guard.reason);
        return refused(guard.message);
      }
      return recordConfirmedAnswers(context, input, guard.checked);
    }
  );
}

async function checkConfirmation(
  context: TurnContext,
  input: TeamsAskConfirmInput
): Promise<Guard> {
  const post = await findTeamsAskPost(context, input.askRef);
  if (!post) {
    return fail(
      TeamsAskConfirmRefusal.AskNotFound,
      `askRef ${input.askRef} is not a teams_ask post of this case.`
    );
  }
  const { ask } = post;
  if (
    ask.connectionKey !== undefined &&
    !context.grants.ask.has(ask.connectionKey)
  ) {
    return fail(
      NOT_GRANTED_REASON,
      `${ask.connectionKey}: ask is not granted: add it under agent.orchestrator.connections (docs/orchestrator.md).`
    );
  }
  const conversationIds = await caseConversationIds(context);
  const summary = await findLatestSummary(
    context,
    conversationIds,
    input.askRef
  );
  if (!summary) {
    return fail(
      TeamsAskConfirmRefusal.SummaryMissing,
      "Post the answers with teams_ask_reply answers first; then wait for an asked person to confirm."
    );
  }
  const confirmation = await findConfirmation(
    context,
    conversationIds,
    input.confirmationRef
  );
  if (!confirmation) {
    return fail(
      TeamsAskConfirmRefusal.ConfirmationNotFound,
      `confirmationRef ${input.confirmationRef} is not a message of this case.`
    );
  }
  const problem = await checkConfirmer(
    context,
    conversationIds,
    { ask, summary, confirmation },
    input.askRef
  );
  return problem ?? { ok: true, checked: { ask, summary, confirmation } };
}

async function checkConfirmer(
  context: TurnContext,
  conversationIds: string[],
  checked: Checked,
  askRef: string
): Promise<Guard | null> {
  const { ask, summary, confirmation } = checked;
  const threadRef = askThreadRef(ask, askRef);
  if (confirmation.threadRef !== threadRef) {
    return fail(
      TeamsAskConfirmRefusal.OtherThread,
      "That message is not in the thread of this ask."
    );
  }
  if (confirmation.createdAt <= summary.createdAt) {
    return fail(
      TeamsAskConfirmRefusal.BeforeSummary,
      "That message came before your latest summary: ask the asked people to confirm it."
    );
  }
  const newest = await findThreadSummaryBefore(
    context,
    conversationIds,
    threadRef,
    confirmation.createdAt
  );
  if (newest && newest.id !== summary.id) {
    return fail(
      TeamsAskConfirmRefusal.OtherAskSummary,
      `That message answers the summary of another ask in this thread (askRef ${newest.askRef}): confirm that ask, or ask the asked people to confirm this one.`
    );
  }
  if (!isAskedPerson(ask, confirmation.actorId)) {
    const names = ask.mentions.map((mention) => mention.name).join(", ");
    return fail(
      TeamsAskConfirmRefusal.NotAsked,
      `${confirmation.actor ?? "The writer"} was not asked in the original post; only ${names} can confirm.`
    );
  }
  return null;
}

function fail(reason: string, message: string): Guard {
  return { ok: false, reason, message };
}

/** The newest bot post in the ask thread that carries a summary of answers. */
async function findLatestSummary(
  context: TurnContext,
  conversationIds: string[],
  askRef: string
): Promise<Summary | null> {
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId: context.organizationId,
        conversationId: { in: conversationIds },
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        payload: { path: ["teamsAskReply", "askRef"], equals: askRef },
      },
      orderBy: { createdAt: "desc" },
      take: SUMMARIES_SCANNED,
      select: { id: true, createdAt: true, payload: true },
    })
  );
  for (const row of rows) {
    const entries = readTeamsAskReply(row.payload)?.summary;
    if (entries && entries.length > 0) {
      return { id: row.id, createdAt: row.createdAt, entries };
    }
  }
  return null;
}

async function findConfirmation(
  context: TurnContext,
  conversationIds: string[],
  confirmationRef: string
): Promise<Confirmation | null> {
  const row = await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        organizationId: context.organizationId,
        conversationId: { in: conversationIds },
        externalRef: confirmationRef,
        origin: OrchestratorMessageOrigin.External,
      },
      select: { id: true, createdAt: true, actor: true, payload: true },
    })
  );
  if (!row) {
    return null;
  }
  const thread = readTeamsAskThread(row.payload);
  return {
    id: row.id,
    createdAt: row.createdAt,
    actor: row.actor,
    actorId: thread?.actorId ?? null,
    askRef: thread?.askRef ?? null,
    threadRef: thread?.threadRef ?? thread?.askRef ?? null,
  };
}

/** The newest summary posted in the thread before the confirming message, whichever ask. */
async function findThreadSummaryBefore(
  context: TurnContext,
  conversationIds: string[],
  threadRef: string,
  before: Date
): Promise<{ id: string; askRef: string } | null> {
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId: context.organizationId,
        conversationId: { in: conversationIds },
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        createdAt: { lt: before },
        OR: [
          {
            payload: {
              path: ["teamsAskReply", "threadRef"],
              equals: threadRef,
            },
          },
          { payload: { path: ["teamsAskReply", "askRef"], equals: threadRef } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: SUMMARIES_SCANNED,
      select: { id: true, payload: true },
    })
  );
  for (const row of rows) {
    const reply = readTeamsAskReply(row.payload);
    if (reply?.summary && reply.summary.length > 0) {
      return { id: row.id, askRef: reply.askRef };
    }
  }
  return null;
}

async function recordConfirmedAnswers(
  context: TurnContext,
  input: TeamsAskConfirmInput,
  checked: Checked
): Promise<ToolOutcome> {
  const { summary, confirmation } = checked;
  const taskId = summary.entries[0]?.taskId ?? "";
  setActiveSpanAttributes({ [AfAttribute.TaskId]: taskId });
  const entries = summary.entries.filter((entry) => entry.taskId === taskId);
  const questionIds = [...new Set(entries.map((entry) => entry.questionId))];
  const payload = {
    via: OrchestratorMessageVia.Teams,
    taskId,
    ...(questionIds.length === 1
      ? { questionId: questionIds[0] }
      : { questionIds }),
    answers: entries.map((entry) => ({
      taskId,
      questionId: entry.questionId,
      answer: entry.answer,
    })),
    teamsAskConfirm: {
      askRef: input.askRef,
      summaryMessageId: summary.id,
      confirmationRef: input.confirmationRef,
      confirmedBy: { id: confirmation.actorId, name: confirmation.actor },
    },
  } as JsonObject;
  try {
    const covered = await withDb.tx(async (tx) => {
      const created = await tx.orchestratorMessage.create({
        data: {
          organizationId: context.organizationId,
          conversationId: context.conversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.AnswersRecorded,
          actor: confirmation.actor,
          turnId: context.turnId,
          externalRef: null,
          dedupKey: `teams_ask_confirm:${summary.id}`,
          text: describeAnswers(taskId, confirmation.actor, entries),
          payload,
        },
        select: { id: true },
      });
      return coverTaskQuestions(tx, {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        messageId: created.id,
        taskId,
        questionIds,
      });
    });
    return await answersOutcome(context, taskId, questionIds, covered);
  } catch (error) {
    if (getPrismaErrorCode(error) === PRISMA_UNIQUE_VIOLATION) {
      return {
        ok: true,
        output: { recorded: true, alreadyRecorded: true, taskId } as JsonObject,
      };
    }
    throw error;
  }
}

async function answersOutcome(
  context: TurnContext,
  taskId: string,
  questionIds: string[],
  covered: number
): Promise<ToolOutcome> {
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: {
        id: taskId,
        caseId: context.caseId,
        organizationId: context.organizationId,
      },
      select: { openQuestionCount: true },
    })
  );
  log.info("orchestrator.teams_ask.answers_recorded", {
    organizationId: context.organizationId,
    caseId: context.caseId,
    conversationId: context.conversationId,
    taskId,
    covered,
  });
  return {
    ok: true,
    output: {
      recorded: true,
      taskId,
      answered: questionIds,
      openQuestions: task?.openQuestionCount ?? 0,
      next: `Keep the answers in the notes; when the task has no open questions, resume it: task_run resumeTaskId ${taskId} (no fork) with the answers.`,
    } as JsonObject,
  };
}

function describeAnswers(
  taskId: string,
  actor: string | null,
  entries: TeamsAskSummaryEntry[]
): string {
  const lines = entries.map((e) => `- ${e.question}: ${e.answer}`);
  return `Answers to the questions of task ${taskId}, confirmed in Teams by ${actor ?? "an asked person"}:\n${lines.join("\n")}`;
}
