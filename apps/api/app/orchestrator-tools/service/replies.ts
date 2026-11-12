import { randomUUID } from "node:crypto";
import type { JsonObject } from "@repo/api/src/types/common";
import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorReplyTarget,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { createProviderContext } from "@/lib/integrations/connection-service";
import type { SourceItemFile } from "@/lib/integrations/types";
import {
  findCaseTaskFiles,
  type TaskFileRef,
} from "@/lib/orchestrator/task-files";
import { TEAMS_ASK_ANCHOR_ARTIFACT } from "@/lib/orchestrator/teams-ask";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { uploadReplyFiles } from "./attachments";
import { latestMessageRef, replyTargetOf, replyThread } from "./threads";
import {
  loadConversationConnection,
  notGranted,
  refused,
  type ToolOutcome,
  type TurnContext,
} from "./turn";

/** The orchestrator's messages in the item's thread: reply, edit_reply. */

const PRISMA_UNIQUE_VIOLATION = "P2002";
const LOG_PREFIX = "[orchestrator-tools]";

export async function reply(
  context: TurnContext,
  text: string,
  attachments: TaskFileRef[] = [],
  replyTo?: string,
  where?: OrchestratorReplyTarget
): Promise<ToolOutcome> {
  const target =
    where ?? (await replyTargetOf(context.conversationId, replyTo));
  if (target === null) {
    return refused(
      `replyTo: ${replyTo} is not a message of this conversation (use the ref of a <message> you were given).`
    );
  }
  if (target === OrchestratorReplyTarget.CasePage) {
    return await replyOnCasePage(context, text, attachments, replyTo);
  }
  if (!context.grants.source.has(OrchestratorSourceOperation.Comment)) {
    return notGranted("source: comment");
  }
  if (
    attachments.length > 0 &&
    !context.grants.source.has(OrchestratorSourceOperation.Attach)
  ) {
    return notGranted("source: attach");
  }
  const channel = context.channel;
  const connection = await loadConversationConnection(context);
  const replyOnItem = connection?.provider.replyOnItem;
  if (!(channel && connection && replyOnItem)) {
    return refused("This conversation has no thread AgentFlow can post in.");
  }
  const answered = await replyThread(context.conversationId, replyTo);
  if (answered === null) {
    return refused(
      `replyTo: ${replyTo} is not a message of this conversation (use the ref of a <message> you were given).`
    );
  }
  let files: SourceItemFile[] = [];
  if (attachments.length > 0) {
    const uploaded = await uploadReplyFiles({
      caseId: context.caseId,
      refs: attachments,
      connection,
      item: channel.item,
    });
    if (!uploaded.ok) {
      return { ok: false, ...uploaded.error };
    }
    files = uploaded.value;
  }
  const parentId =
    channel.parentId ??
    answered ??
    (await latestMessageRef(context.conversationId));
  const posted = await replyOnItem(
    createProviderContext(connection.runtime, LOG_PREFIX),
    {
      item: channel.item,
      parentId,
      text,
      extras: channel.extras,
      ...(files.length > 0 ? { files } : {}),
    }
  );
  if (!posted.ok) {
    const attachedNote =
      files.length > 0
        ? ` Attached before it: ${files.map((file) => file.name).join(", ")}.`
        : "";
    return {
      ok: false,
      error: `${scrubProviderError(posted.error, connection.runtime.secrets)}${attachedNote}`,
      retryable: posted.retryable,
    };
  }
  // The comment is on the item already: a failed history write must not look
  // like a failed post, or the caller posts it a second time.
  const recorded = await recordReplySafely(
    context,
    text,
    posted.externalRef,
    connection.record.id,
    attachments
  );
  return {
    ok: true,
    output: {
      posted: true,
      reference: posted.externalRef,
      ...(recorded ? {} : { recorded: false }),
      ...(files.length > 0 ? { attached: files.map((file) => file.name) } : {}),
    } as JsonObject,
  };
}

/** Replaces a message this conversation posted; its anchor keeps the reference. */
export async function editReply(
  context: TurnContext,
  input: { reference: string; text: string; version?: number }
): Promise<ToolOutcome> {
  if (!context.grants.source.has(OrchestratorSourceOperation.Comment)) {
    return notGranted("source: comment");
  }
  const channel = context.channel;
  const anchor = await withDb((db) =>
    db.orchestratorAnchor.findFirst({
      where: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        externalRef: input.reference,
      },
      select: { id: true, artifact: true },
    })
  );
  if (anchor?.artifact === TEAMS_ASK_ANCHOR_ARTIFACT) {
    return refused(
      "A teams_ask post cannot be edited: ask again with teams_ask."
    );
  }
  if (!(anchor && channel)) {
    return refused(
      "Edit only a message this conversation posted (the reference reply returned)."
    );
  }
  const connection = await loadConversationConnection(context);
  const editOnItem = connection?.provider.editOnItem;
  if (!(connection && editOnItem)) {
    return refused("Messages of this conversation's thread cannot be edited.");
  }
  const edited = await editOnItem(
    createProviderContext(connection.runtime, LOG_PREFIX),
    {
      item: channel.item,
      externalRef: input.reference,
      text: input.text,
      extras: channel.extras,
    }
  );
  if (!edited.ok) {
    return {
      ok: false,
      error: scrubProviderError(edited.error, connection.runtime.secrets),
      retryable: edited.retryable,
    };
  }
  if (input.version) {
    await withDb((db) =>
      db.orchestratorAnchor.update({
        where: { id: anchor.id },
        data: { version: input.version },
      })
    );
  }
  return { ok: true, output: { edited: true, reference: input.reference } };
}

async function recordReplySafely(
  context: TurnContext,
  text: string,
  externalRef: string | null,
  connectionId: string,
  attachments: TaskFileRef[]
): Promise<boolean> {
  try {
    await recordReply(context, text, externalRef, connectionId, attachments);
    return true;
  } catch (error) {
    log.error(`${LOG_PREFIX} reply posted but not recorded in the history`, {
      error,
    });
    return false;
  }
}

/** The orchestrator's message in the history, and an anchor for replies to it. */
async function recordReply(
  context: TurnContext,
  text: string,
  externalRef: string | null,
  connectionId: string,
  attachments: TaskFileRef[]
): Promise<void> {
  const provider = context.channel?.item.provider ?? "agentflow";
  await withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        actor: null,
        text,
        externalRef,
        dedupKey: `reply:${context.turnId}:${externalRef ?? Date.now()}`,
        turnId: context.turnId,
        ...(attachments.length > 0 ? { payload: { attachments } } : {}),
      },
    })
  );
  if (!externalRef) {
    return;
  }
  try {
    await withDb((db) =>
      db.orchestratorAnchor.create({
        data: {
          organizationId: context.organizationId,
          conversationId: context.conversationId,
          connectionId,
          provider,
          externalRef,
        },
      })
    );
  } catch (error) {
    if (getPrismaErrorCode(error) !== PRISMA_UNIQUE_VIOLATION) {
      throw error;
    }
  }
}

/** Where a reply goes when the caller does not say: see replyTargetOf. */
export async function resolveReplyTarget(
  context: TurnContext,
  replyTo?: string,
  where?: OrchestratorReplyTarget
): Promise<OrchestratorReplyTarget> {
  return (
    where ??
    (await replyTargetOf(context.conversationId, replyTo)) ??
    OrchestratorReplyTarget.Thread
  );
}

/** A reply shown on the case page only: no grant, no connection, no anchor. */
async function replyOnCasePage(
  context: TurnContext,
  text: string,
  attachments: TaskFileRef[],
  replyTo: string | undefined
): Promise<ToolOutcome> {
  let names: string[] = [];
  if (attachments.length > 0) {
    const found = await findCaseTaskFiles(context.caseId, attachments);
    if (!found.ok) {
      return refused(found.error);
    }
    names = found.value.map((file) => file.name);
  }
  await withDb((db) =>
    db.orchestratorMessage.create({
      data: {
        organizationId: context.organizationId,
        conversationId: context.conversationId,
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        actor: null,
        text,
        externalRef: null,
        payload: {
          via: OrchestratorMessageVia.AgentFlow,
          replyTo: replyTo ?? null,
          ...(attachments.length > 0 ? { attachments } : {}),
        },
        dedupKey: `reply:${context.turnId}:${randomUUID()}`,
        turnId: context.turnId,
      },
    })
  );
  return {
    ok: true,
    output: {
      posted: true,
      where: OrchestratorReplyTarget.CasePage,
      ...(names.length > 0 ? { attached: names } : {}),
    },
  };
}
