import {
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorReplyTarget,
  readOrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";

/**
 * Where an orchestrator reply goes in an item's comments (Jira threads have
 * one level, so a thread is its first comment).
 */

/**
 * The thread of the conversation's latest message from people; null (a new
 * comment) when that message is a ticket change or there is none.
 */
export async function latestMessageRef(
  conversationId: string
): Promise<string | null> {
  // A message written on the case page has no thread in the item's comments.
  const latest = (await newestExternal(conversationId)).find(
    (message) => !fromAgentFlow(message.payload)
  );
  // A ticket change (a status or label change) is no comment: what answers
  // it is a new comment on the item, not a reply in an earlier thread.
  if (!latest?.externalRef) {
    return null;
  }
  const thread = messageThreadSchema.safeParse(latest.payload);
  return (thread.success ? thread.data.parentId : null) ?? latest.externalRef;
}

/**
 * The thread a reply to one of this conversation's messages goes in: its
 * thread's first comment (threads have one level), else the message itself.
 * null when the conversation has no such message.
 */
export async function messageThread(
  conversationId: string,
  externalRef: string
): Promise<string | null> {
  const message = await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        conversationId,
        origin: OrchestratorMessageOrigin.External,
        externalRef,
      },
      select: { externalRef: true, payload: true },
    })
  );
  if (!message?.externalRef) {
    return null;
  }
  const thread = messageThreadSchema.safeParse(message.payload);
  return (thread.success ? thread.data.parentId : null) ?? message.externalRef;
}

const messageThreadSchema = z.object({
  parentId: z.string().min(1).nullable(),
});

/**
 * Where a reply goes by default: the case page when the message it answers
 * (replyTo, else the conversation's latest message from outside) was written
 * there, else the item's thread. null when replyTo is no message of the
 * conversation.
 */
export async function replyTargetOf(
  conversationId: string,
  replyTo?: string
): Promise<OrchestratorReplyTarget | null> {
  if (replyTo !== undefined) {
    const message = await findExternal(conversationId, replyTo);
    if (!message) {
      return null;
    }
    return targetOf(message.payload);
  }
  const [latest] = await newestExternal(conversationId, 1);
  return targetOf(latest?.payload);
}

/**
 * The thread to answer in for replyTo: undefined when there is none or it is
 * a message from the case page (the latest ticket thread answers then); null
 * when it is no message of the conversation.
 */
export async function replyThread(
  conversationId: string,
  replyTo: string | undefined
): Promise<string | null | undefined> {
  if (replyTo === undefined) {
    return undefined;
  }
  const message = await findExternal(conversationId, replyTo);
  if (!message?.externalRef) {
    return null;
  }
  if (fromAgentFlow(message.payload)) {
    return undefined;
  }
  return threadOf(message.payload) ?? message.externalRef;
}

const NEWEST_MESSAGES = 20;

type ExternalMessage = { externalRef: string | null; payload: unknown };

async function newestExternal(
  conversationId: string,
  take = NEWEST_MESSAGES
): Promise<ExternalMessage[]> {
  return await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: { conversationId, origin: OrchestratorMessageOrigin.External },
      orderBy: { createdAt: "desc" },
      take,
      select: { externalRef: true, payload: true },
    })
  );
}

async function findExternal(
  conversationId: string,
  externalRef: string
): Promise<ExternalMessage | null> {
  return await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        conversationId,
        origin: OrchestratorMessageOrigin.External,
        externalRef,
      },
      select: { externalRef: true, payload: true },
    })
  );
}

function fromAgentFlow(payload: unknown): boolean {
  return (
    readOrchestratorMessageVia(payload) === OrchestratorMessageVia.AgentFlow
  );
}

function targetOf(payload: unknown): OrchestratorReplyTarget {
  return fromAgentFlow(payload)
    ? OrchestratorReplyTarget.CasePage
    : OrchestratorReplyTarget.Thread;
}

function threadOf(payload: unknown): string | null {
  const thread = messageThreadSchema.safeParse(payload);
  return thread.success ? thread.data.parentId : null;
}
