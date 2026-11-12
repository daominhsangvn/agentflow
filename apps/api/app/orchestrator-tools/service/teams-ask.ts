import type { JsonObject } from "@repo/api/src/types/common";
import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
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
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { REPLY_ATTACHMENTS_MAX } from "./attachments";
import { REPLY_MAX, TEAMS_ASK_MENTIONS_MAX } from "./limits";
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
const QUESTIONS_MAX = 20;
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
    .max(QUESTIONS_MAX)
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

export async function askInTeams(
  context: TurnContext,
  input: TeamsAskInput
): Promise<ToolOutcome> {
  if (context.grants.ask.size === 0) {
    return notGranted("<teams connection key>: ask");
  }
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
    return refused(chosen.error);
  }
  const channel = chosen.value;
  const problem = await checkQuestions(context, input.questions);
  if (problem) {
    return refused(problem);
  }
  const files = await findCaseTaskFiles(context.caseId, input.attachments);
  if (!files.ok) {
    return refused(files.error);
  }
  const teams = await loadTeams(context.organizationId, channel);
  if (!teams.ok) {
    return refused(teams.error);
  }
  const body = await buildBody(
    context,
    input.text,
    files.value.map((file) => file.name)
  );
  const serviceUrl = await findServiceUrl(
    context.organizationId,
    teams.value.connectionId
  );
  const posted = await postTeamsAsk(teams.value.context, {
    serviceUrl,
    channelId: channel.channelId,
    emails: input.mentions,
    text: body,
  });
  if (!posted.ok) {
    return {
      ok: false,
      error: scrubProviderError(posted.error.error, teams.value.secrets),
      retryable: posted.error.retryable,
    };
  }
  const recorded = await recordAskSafely(context, {
    input,
    channel,
    connectionId: teams.value.connectionId,
    rootMessageId: posted.value.rootMessageId,
    mentions: posted.value.mentions,
  });
  return {
    ok: true,
    output: {
      posted: true,
      reference: posted.value.rootMessageId,
      mentioned: posted.value.mentions.map((mention) => mention.name),
      channel: channel.alias,
      connection: channel.connectionKey,
      ...(recorded ? {} : { recorded: false }),
    } as JsonObject,
  };
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

async function loadTeams(
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
async function findServiceUrl(
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

type AskRecord = {
  input: TeamsAskInput;
  channel: TeamsAskChannelOption;
  connectionId: string;
  rootMessageId: string;
  mentions: TeamsAskMention[];
};

async function recordAskSafely(
  context: TurnContext,
  record: AskRecord
): Promise<boolean> {
  try {
    await recordAsk(context, record);
    return true;
  } catch (error) {
    log.error(`${LOG_PREFIX} teams_ask posted but not recorded`, { error });
    return false;
  }
}

async function recordAsk(
  context: TurnContext,
  record: AskRecord
): Promise<void> {
  const { input, channel, rootMessageId } = record;
  await withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        actor: null,
        text: input.text,
        externalRef: rootMessageId,
        dedupKey: `teams_ask:${context.turnId}:${rootMessageId}`,
        turnId: context.turnId,
        payload: {
          teamsAsk: {
            channelId: channel.channelId,
            channel: channel.alias,
            connectionKey: channel.connectionKey,
            mentions: record.mentions,
            questions: input.questions,
          },
          attachments: input.attachments,
        },
      },
    })
  );
  const [only] = input.questions;
  try {
    await withDb((db) =>
      db.orchestratorAnchor.create({
        data: {
          organizationId: context.organizationId,
          conversationId: context.conversationId,
          connectionId: record.connectionId,
          provider: IntegrationProviderKey.MicrosoftTeams,
          externalRef: rootMessageId,
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
