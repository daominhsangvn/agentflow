import { randomUUID } from "node:crypto";
import type { JsonObject } from "@repo/api/src/types/common";
import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { z } from "zod";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { createProviderContext } from "@/lib/integrations/connection-service";
import { loadProjectConnectionRuntime } from "@/lib/integrations/project-connections";
import {
  checkServiceUrl,
  teamsGlobalServiceUrl,
} from "@/lib/integrations/providers/microsoft-teams/bot-connector";
import {
  postTeamsAsk,
  type TeamsAskMention,
} from "@/lib/integrations/providers/microsoft-teams/channel-ask";
import type { TeamsProviderContext } from "@/lib/integrations/providers/microsoft-teams/connection";
import {
  findCaseTaskFiles,
  taskFileRefSchema,
} from "@/lib/orchestrator/task-files";
import { readTaskResult } from "@/lib/orchestrator/task-result";
import { TEAMS_ASK_ANCHOR_ARTIFACT } from "@/lib/orchestrator/teams-ask";
import {
  loadTeamsAskChannels,
  resolveTeamsAskChannel,
  type TeamsAskChannelOption,
} from "@/lib/orchestrator/teams-ask-channels";
import { findCaseAskThread } from "@/lib/orchestrator/teams-ask-threads";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { REPLY_ATTACHMENTS_MAX } from "./attachments";
import {
  REPLY_MAX,
  TEAMS_ASK_MENTIONS_MAX,
  TEAMS_ASK_QUESTIONS_MAX,
} from "./limits";
import {
  caseLink,
  notGranted,
  refused,
  type ToolOutcome,
  type TurnContext,
} from "./turn";

/** teams_ask: a new message in an allowed Teams ask channel that @mentions people. */

const LOG_PREFIX = "[orchestrator-tools]";
const PRISMA_UNIQUE_VIOLATION = "P2002";
const DELIVERIES_SCANNED = 20;

export const teamsAskInputSchema = z.object({
  mentions: z
    .array(z.email().transform((email) => email.trim().toLowerCase()))
    .min(1)
    .max(TEAMS_ASK_MENTIONS_MAX)
    .transform((emails) => [...new Set(emails)]),
  text: z.string().trim().min(1).max(REPLY_MAX),
  channel: z.string().trim().min(1).max(255).optional(),
  questions: z
    .array(
      z.object({ taskId: z.string().min(1), questionId: z.string().min(1) })
    )
    .max(TEAMS_ASK_QUESTIONS_MAX)
    .default([]),
  attachments: z
    .array(taskFileRefSchema)
    .max(REPLY_ATTACHMENTS_MAX)
    .default([]),
  connection: z.string().trim().min(1).max(255).optional(),
});
export type TeamsAskInput = z.infer<typeof teamsAskInputSchema>;

type AskQuestion = TeamsAskInput["questions"][number];
type LoadedTeams = {
  context: TeamsProviderContext;
  connectionId: string;
  secrets: Record<string, unknown>;
};

export function askInTeams(
  context: TurnContext,
  input: TeamsAskInput
): Promise<ToolOutcome> {
  return withSpan(
    "orchestrator.teams_ask",
    {
      [AfAttribute.OrgId]: context.organizationId,
      [AfAttribute.CaseId]: context.caseId,
      [AfAttribute.ConversationId]: context.conversationId,
      [AfAttribute.TurnId]: context.turnId,
    },
    async () => {
      if (context.grants.ask.size === 0) {
        setSpanOutcome(AfOutcome.Rejected, "not_granted");
        return notGranted("<teams connection key>: ask");
      }
      const prepared = await prepareAsk(context, input);
      if (!prepared.ok) {
        setSpanOutcome(AfOutcome.Rejected, prepared.error.reason);
        return refused(prepared.error.message);
      }
      return postAndRecordAsk(context, input, prepared.value);
    }
  );
}

type PreparedAsk = {
  channel: TeamsAskChannelOption;
  teams: LoadedTeams;
  body: string;
  serviceUrl: URL;
  threadRef: string | null;
};
type AskRefusal = { reason: string; message: string };

async function prepareAsk(
  context: TurnContext,
  input: TeamsAskInput
): Promise<Result<PreparedAsk, AskRefusal>> {
  const options = await loadTeamsAskChannels(
    context.organizationId,
    context.projectId,
    context.grants.ask
  );
  const chosen = resolveTeamsAskChannel(options, {
    channel: input.channel,
    connection: input.connection,
  });
  if (!chosen.ok) {
    return Result.err({ reason: "channel_not_allowed", message: chosen.error });
  }
  const channel = chosen.value;
  const problem = await checkQuestions(context, input.questions);
  if (problem) {
    return Result.err({ reason: "invalid_questions", message: problem });
  }
  const files = await findCaseTaskFiles(context.caseId, input.attachments);
  if (!files.ok) {
    return Result.err({
      reason: "attachments_not_found",
      message: files.error,
    });
  }
  const teams = await loadTeams(context.organizationId, channel);
  if (!teams.ok) {
    return Result.err({
      reason: "connection_not_loaded",
      message: teams.error,
    });
  }
  const threadRef = await findCaseAskThread(
    {
      organizationId: context.organizationId,
      caseId: context.caseId,
      connectionId: teams.value.connectionId,
    },
    { channelId: channel.channelId, connectionKey: channel.connectionKey }
  );
  const body = await buildBody(
    context,
    input.text,
    files.value.map((file) => file.name)
  );
  const serviceUrl = await findServiceUrl(
    context.organizationId,
    teams.value.connectionId
  );
  return Result.ok({
    channel,
    teams: teams.value,
    body,
    serviceUrl,
    threadRef,
  });
}

async function postAndRecordAsk(
  context: TurnContext,
  input: TeamsAskInput,
  prepared: PreparedAsk
): Promise<ToolOutcome> {
  const { channel, teams } = prepared;
  const posted = await postWithThreadFallback(context, input, prepared);
  if (!posted.ok) {
    setSpanOutcome(AfOutcome.Error, "teams_post_failed");
    return {
      ok: false,
      error: scrubProviderError(posted.error.error, teams.secrets),
      retryable: posted.error.retryable,
    };
  }
  const askRef = chooseAskRef(posted.value);
  const recorded = await recordAskSafely(context, {
    input,
    channel,
    connectionId: teams.connectionId,
    askRef,
    posted: posted.value,
  });
  return {
    ok: true,
    output: {
      posted: true,
      reference: askRef,
      threadRef: posted.value.rootMessageId,
      thread: posted.value.inThread
        ? TeamsAskThreadMode.Continued
        : TeamsAskThreadMode.New,
      mentioned: posted.value.mentions.map((mention) => mention.name),
      channel: channel.alias,
      connection: channel.connectionKey,
      ...(recorded ? {} : { recorded: false }),
    } as JsonObject,
  };
}

/** Posts into the case's thread; a non-retryable failure there falls back to a new post. */
async function postWithThreadFallback(
  context: TurnContext,
  input: TeamsAskInput,
  prepared: PreparedAsk
): Promise<Awaited<ReturnType<typeof postTeamsAsk>>> {
  const { channel, teams, body, serviceUrl, threadRef } = prepared;
  const request = {
    serviceUrl,
    channelId: channel.channelId,
    emails: input.mentions,
    text: body,
  };
  if (!threadRef) {
    return postTeamsAsk(teams.context, request);
  }
  const inThread = await postTeamsAsk(teams.context, {
    ...request,
    threadRootId: threadRef,
  });
  if (inThread.ok || inThread.error.retryable) {
    return inThread;
  }
  log.warn(`${LOG_PREFIX} teams_ask thread reply failed, posting anew`, {
    reason: "teams_ask_thread_reply_failed",
    organizationId: context.organizationId,
    caseId: context.caseId,
    conversationId: context.conversationId,
    turnId: context.turnId,
    threadRef,
    error: inThread.error.error,
  });
  return postTeamsAsk(teams.context, request);
}

function chooseAskRef(posted: AskPostedRef): string {
  if (!posted.inThread) {
    return posted.rootMessageId;
  }
  return posted.messageId ?? `ask-${randomUUID()}`;
}

/** Every question belongs to one task of this case and exists in its result. */
async function checkQuestions(
  context: TurnContext,
  questions: AskQuestion[]
): Promise<string | null> {
  const first = questions[0];
  if (!first) {
    return null;
  }
  if (questions.some((question) => question.taskId !== first.taskId)) {
    return "questions: one task per teams_ask.";
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
  if (!task) {
    return `questions: task ${first.taskId} is not a task of this case.`;
  }
  const known = readTaskResult(task.result)?.questions.map((q) => q.id) ?? [];
  const unknown = questions.filter(
    (question) => !known.includes(question.questionId)
  );
  if (unknown.length > 0) {
    return `questions: unknown question id ${unknown.map((q) => q.questionId).join(", ")}; the task asked: ${known.join(", ") || "nothing"}.`;
  }
  return null;
}

export async function loadTeams(
  organizationId: string,
  channel: TeamsAskChannelOption
): Promise<Result<LoadedTeams, string>> {
  const runtime = await loadProjectConnectionRuntime(
    organizationId,
    channel.projectConnectionId
  );
  if (!runtime) {
    return Result.err(
      `The Teams connection ${channel.connectionKey} could not be loaded: check it under Project → Integrations.`
    );
  }
  return Result.ok({
    context: createProviderContext(
      runtime.connection.runtime,
      LOG_PREFIX
    ) as TeamsProviderContext,
    connectionId: runtime.connection.record.id,
    secrets: runtime.connection.runtime.secrets,
  });
}

async function buildBody(
  context: TurnContext,
  text: string,
  fileNames: string[]
): Promise<string> {
  const link = await caseLink(context);
  const key = context.channel?.item.key;
  let body = text;
  if (fileNames.length > 0) {
    const list = fileNames
      .map((name) => (link ? `[${name}](${link})` : name))
      .join(", ");
    body += `\n\nFiles (open them on the case page): ${list}`;
  }
  if (link) {
    body += `\n\nCase: [${key ?? "open"}](${link})`;
  }
  return body;
}

const deliveryPayloadSchema = z.looseObject({ serviceUrl: z.string() });

/** The newest serviceUrl a verified delivery carried, else the global one. */
export async function findServiceUrl(
  organizationId: string,
  connectionId: string
): Promise<URL> {
  const rows = await withDb((db) =>
    db.integrationDelivery.findMany({
      where: { organizationId, connectionId },
      orderBy: { receivedAt: "desc" },
      take: DELIVERIES_SCANNED,
      select: { payload: true },
    })
  );
  for (const row of rows) {
    const parsed = deliveryPayloadSchema.safeParse(row.payload);
    const url = parsed.success ? checkServiceUrl(parsed.data.serviceUrl) : null;
    if (url) {
      return url;
    }
  }
  return checkServiceUrl(teamsGlobalServiceUrl()) as URL;
}

type AskPostedRef = {
  rootMessageId: string;
  messageId: string | null;
  inThread: boolean;
};
type AskRecord = {
  input: TeamsAskInput;
  channel: TeamsAskChannelOption;
  connectionId: string;
  askRef: string;
  posted: AskPostedRef & { mentions: TeamsAskMention[] };
};

async function recordAskSafely(
  context: TurnContext,
  record: AskRecord
): Promise<boolean> {
  try {
    await recordAsk(context, record);
    return true;
  } catch (error) {
    setSpanOutcome(AfOutcome.Error, "teams_ask_not_recorded");
    log.error(`${LOG_PREFIX} teams_ask posted but not recorded`, {
      reason: "teams_ask_not_recorded",
      organizationId: context.organizationId,
      caseId: context.caseId,
      conversationId: context.conversationId,
      turnId: context.turnId,
      askRef: record.askRef,
      error,
    });
    return false;
  }
}

async function recordAsk(
  context: TurnContext,
  record: AskRecord
): Promise<void> {
  const { input, channel, askRef, posted } = record;
  await withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        actor: null,
        text: input.text,
        externalRef: askRef,
        dedupKey: `teams_ask:${context.turnId}:${askRef}`,
        turnId: context.turnId,
        payload: {
          teamsAsk: {
            channelId: channel.channelId,
            channel: channel.alias,
            connectionKey: channel.connectionKey,
            mentions: posted.mentions,
            questions: input.questions,
            threadRef: posted.rootMessageId,
          },
          attachments: input.attachments,
        },
      },
    })
  );
  if (posted.inThread) {
    return;
  }
  const [only] = input.questions;
  try {
    await withDb((db) =>
      db.orchestratorAnchor.create({
        data: {
          organizationId: context.organizationId,
          conversationId: context.conversationId,
          connectionId: record.connectionId,
          provider: IntegrationProviderKey.MicrosoftTeams,
          externalRef: posted.rootMessageId,
          artifact: TEAMS_ASK_ANCHOR_ARTIFACT,
          taskId: only?.taskId ?? null,
          questionId: input.questions.length === 1 ? only?.questionId : null,
        },
      })
    );
  } catch (error) {
    if (getPrismaErrorCode(error) !== PRISMA_UNIQUE_VIOLATION) {
      throw error;
    }
  }
}

export const TeamsAskThreadMode = {
  New: "new",
  Continued: "continued",
} as const;
