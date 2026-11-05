import { randomUUID } from "node:crypto";
import type { JsonObject } from "@repo/api/src/types/common";
import { SourceOperation } from "@repo/api/src/types/connection-grants";
import { OrchestratorMessageOrigin } from "@repo/api/src/types/orchestrator";
import {
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { withDb } from "@repo/database";
import { z } from "zod";
import { sourceGrantDefinitions } from "@/lib/integrations/connection-grants";
import {
  createProviderContext,
  type LoadedConnection,
} from "@/lib/integrations/connection-service";
import { getIntegrationProvider } from "@/lib/integrations/registry";
import type {
  InboundItemChange,
  SourceItemRef,
  WorkflowRunSnapshot,
} from "@/lib/integrations/types";
import type { ConversationChannel } from "@/lib/orchestrator/channel";
import { ticketChangeMessage } from "@/lib/orchestrator/ticket-change";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { refused, type ToolOutcome } from "./turn";

/**
 * The orchestrator's writes on the case's own ticket (source_item_transition,
 * source_item_label, source_item_link): the provider's source actions, run
 * for the conversation's item. The bot's own status and label changes are
 * recorded on the case, so people see them and the next turn knows them.
 */

const LOG_PREFIX = "[orchestrator-tools]";
const BOT_ACTOR = "AgentFlow";
const LABELS_MAX = 20;

export const sourceTransitionInputSchema = z.object({
  transitionName: z.string().trim().min(1).max(128),
});

const labelListSchema = z
  .array(z.string().trim().min(1).max(255))
  .max(LABELS_MAX)
  .default([]);

export const sourceLabelInputSchema = z
  .object({ add: labelListSchema, remove: labelListSchema })
  .refine((input) => input.add.length + input.remove.length > 0, {
    message: "Add or remove at least one label",
  });

export const sourceLinkInputSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  title: z.string().trim().min(1).max(255),
});

export type SourceWriteContext = {
  organizationId: string;
  caseId: string;
  conversationId: string;
  turnId: string;
  channel: ConversationChannel;
  connection: LoadedConnection;
  workflow: { id: string; name: string };
  caseUrl: string;
};

/** One write on the item, with what the provider's action needs. */
export type SourceWrite =
  | { op: typeof SourceOperation.Transition; transitionName: string }
  | { op: typeof SourceOperation.Label; add: string[]; remove: string[] }
  | { op: typeof SourceOperation.Link; url: string; title: string };

export async function runSourceWrite(
  context: SourceWriteContext,
  write: SourceWrite
): Promise<ToolOutcome> {
  const { channel, connection } = context;
  const definition = sourceGrantDefinitions(channel.item.provider, [
    write.op,
  ])[0];
  if (!definition) {
    const name =
      getIntegrationProvider(channel.item.provider)?.displayName ??
      channel.item.provider;
    return refused(`This conversation's item (${name}) cannot ${write.op}.`);
  }
  const config = definition.configSchema.safeParse(actionConfig(write));
  if (!config.success) {
    return refused(`The ${write.op} could not be prepared for this item.`);
  }
  const before =
    write.op === SourceOperation.Transition ? await readStatus(context) : null;
  let result: Awaited<ReturnType<typeof definition.execute>>;
  try {
    result = await definition.execute({
      ...createProviderContext(connection.runtime, LOG_PREFIX),
      config: config.data,
      run: runSnapshot(context),
      actionRunId: `orchestrator:${context.turnId}:${randomUUID()}`,
      attempt: 1,
      render: (template) => template,
    });
  } catch (error) {
    return {
      ok: false,
      error: scrubProviderError(error, connection.runtime.secrets),
      retryable: true,
    };
  }
  if (result.status === "skipped") {
    return refused(result.reason);
  }
  if (result.status === "failed") {
    return {
      ok: false,
      error: scrubProviderError(result.error, connection.runtime.secrets),
      retryable: result.retryable,
    };
  }
  const change = await recordOwnChange(context, write, before);
  return {
    ok: true,
    output: {
      done: true,
      ...(result.detail ? { detail: result.detail } : {}),
      ...(change?.status
        ? { from: change.status.from, to: change.status.to }
        : {}),
      next: "The ticket changed; say so in the thread if your rules ask.",
    } as JsonObject,
  };
}

function actionConfig(write: SourceWrite): JsonObject {
  switch (write.op) {
    case SourceOperation.Transition:
      // Jira takes a transition name, Azure DevOps a state.
      return {
        transitionName: write.transitionName,
        state: write.transitionName,
      };
    case SourceOperation.Label:
      return { add: write.add, remove: write.remove };
    default:
      return { url: write.url, title: write.title };
  }
}

/** A minimal run for the provider action: the conversation's item and case. */
function runSnapshot(context: SourceWriteContext): WorkflowRunSnapshot {
  return {
    id: context.caseId,
    url: context.caseUrl,
    status: WorkflowRunStatus.Running,
    event: WorkflowRunEvent.Started,
    workflow: context.workflow,
    trigger: null,
    source: context.channel.item,
    sourceExtras: context.channel.extras ?? {},
    feature: null,
    plan: null,
    pullRequest: null,
    pullRequests: [],
    repositories: [],
    repository: null,
    error: null,
    step: null,
    reply: null,
    stepReplies: {},
    documents: [],
    releaseNotes: null,
    summaryMarkdown: "",
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

/** The item's status now; null when the provider cannot say. */
async function readStatus(context: SourceWriteContext): Promise<string | null> {
  const fetchItem = context.connection.provider.source?.fetchItem;
  if (!fetchItem) {
    return null;
  }
  try {
    const item: { status: string | null } = await fetchItem(
      createProviderContext(context.connection.runtime, LOG_PREFIX),
      context.channel.item satisfies SourceItemRef
    );
    return item.status;
  } catch {
    return null;
  }
}

/** Records the bot's own status or label change on the case (a link is no change). */
async function recordOwnChange(
  context: SourceWriteContext,
  write: SourceWrite,
  before: string | null
): Promise<InboundItemChange | null> {
  const change = await changeOf(context, write, before);
  const message = change ? ticketChangeMessage(change, BOT_ACTOR) : null;
  if (!(change && message)) {
    return null;
  }
  await withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: message.kind,
        actor: BOT_ACTOR,
        text: message.text,
        payload: message.payload,
        externalRef: null,
        dedupKey: `source-write:${context.turnId}:${randomUUID()}`,
        turnId: context.turnId,
      },
    })
  );
  return change;
}

async function changeOf(
  context: SourceWriteContext,
  write: SourceWrite,
  before: string | null
): Promise<InboundItemChange | null> {
  if (write.op === SourceOperation.Transition) {
    const after = await readStatus(context);
    return { status: { from: before, to: after ?? write.transitionName } };
  }
  if (write.op === SourceOperation.Label) {
    return { labels: { added: write.add, removed: write.remove } };
  }
  return null;
}
