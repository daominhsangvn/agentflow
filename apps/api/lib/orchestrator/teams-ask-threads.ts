import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";
import {
  askThreadRef,
  isAskedPerson,
  readTeamsAsk,
  TEAMS_ASK_ANCHOR_ARTIFACT,
  type TeamsAskPayload,
} from "./teams-ask";

/**
 * Lookups over the asks of one Teams thread. A case has several conversations
 * and the thread's anchor routes to the first asker's, so every lookup is
 * scoped to the whole case. Callers own the span.
 */

const THREAD_ASKS_MAX = 50;
const RECORDED_MAX = 100;
const CASE_ASKS_MAX = 20;

type CaseScope = { organizationId: string; caseId: string };

export type ThreadAsk = {
  messageId: string;
  askRef: string;
  createdAt: Date;
  ask: TeamsAskPayload;
  recorded: boolean;
};

const confirmPayloadSchema = z.looseObject({
  teamsAskConfirm: z.object({ askRef: z.string() }),
});

/** The ids of every conversation of the case. */
export async function caseConversationIds(scope: CaseScope): Promise<string[]> {
  const rows = await withDb((db) =>
    db.orchestratorConversation.findMany({
      where: { organizationId: scope.organizationId, caseId: scope.caseId },
      select: { id: true },
    })
  );
  return rows.map((row) => row.id);
}

/** The asks of a thread (root ask and later asks in it), newest first. */
export async function findThreadAsks(
  scope: CaseScope,
  threadRef: string
): Promise<ThreadAsk[]> {
  const conversationIds = await caseConversationIds(scope);
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId: scope.organizationId,
        conversationId: { in: conversationIds },
        origin: OrchestratorMessageOrigin.Internal,
        OR: [
          { externalRef: threadRef },
          { payload: { path: ["teamsAsk", "threadRef"], equals: threadRef } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: THREAD_ASKS_MAX,
      select: { id: true, externalRef: true, createdAt: true, payload: true },
    })
  );
  const recorded = await recordedAskRefs(scope, conversationIds);
  const asks: ThreadAsk[] = [];
  for (const row of rows) {
    const ask = readTeamsAsk(row.payload);
    if (ask && row.externalRef) {
      asks.push({
        messageId: row.id,
        askRef: row.externalRef,
        createdAt: row.createdAt,
        ask,
        recorded: recorded.has(row.externalRef),
      });
    }
  }
  return asks;
}

/**
 * The newest open ask that mentions the writer, else the newest open ask, else
 * the newest ask (every ask recorded).
 */
export function pickThreadAsk(
  asks: ThreadAsk[],
  actorId?: string | null
): ThreadAsk | null {
  const open = asks.filter((ask) => !ask.recorded);
  const mentioned = open.find((ask) => isAskedPerson(ask.ask, actorId));
  return mentioned ?? open[0] ?? asks[0] ?? null;
}

/**
 * The thread root of the case's latest ask in the channel whose root still has
 * its teams_ask anchor, or null when the case has none to continue.
 */
export async function findCaseAskThread(
  scope: CaseScope & { connectionId: string },
  channel: { channelId: string; connectionKey: string }
): Promise<string | null> {
  const conversationIds = await caseConversationIds(scope);
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId: scope.organizationId,
        conversationId: { in: conversationIds },
        origin: OrchestratorMessageOrigin.Internal,
        payload: { path: ["teamsAsk", "channelId"], equals: channel.channelId },
      },
      orderBy: { createdAt: "desc" },
      take: CASE_ASKS_MAX,
      select: { externalRef: true, payload: true },
    })
  );
  const tried = new Set<string>();
  for (const row of rows) {
    const ask = readTeamsAsk(row.payload);
    if (!(ask && row.externalRef)) {
      continue;
    }
    if (ask.connectionKey && ask.connectionKey !== channel.connectionKey) {
      continue;
    }
    const root = askThreadRef(ask, row.externalRef);
    if (tried.has(root)) {
      continue;
    }
    tried.add(root);
    if (await isCaseAskAnchor(scope, root)) {
      return root;
    }
  }
  return null;
}

async function recordedAskRefs(
  scope: CaseScope,
  conversationIds: string[]
): Promise<Set<string>> {
  const rows = await withDb((db) =>
    db.orchestratorMessage.findMany({
      where: {
        organizationId: scope.organizationId,
        conversationId: { in: conversationIds },
        kind: OrchestratorMessageKind.AnswersRecorded,
      },
      orderBy: { createdAt: "desc" },
      take: RECORDED_MAX,
      select: { payload: true },
    })
  );
  const refs = new Set<string>();
  for (const row of rows) {
    const parsed = confirmPayloadSchema.safeParse(row.payload);
    if (parsed.success) {
      refs.add(parsed.data.teamsAskConfirm.askRef);
    }
  }
  return refs;
}

async function isCaseAskAnchor(
  scope: CaseScope & { connectionId: string },
  root: string
): Promise<boolean> {
  const anchor = await withDb((db) =>
    db.orchestratorAnchor.findUnique({
      where: {
        organizationId_connectionId_externalRef: {
          organizationId: scope.organizationId,
          connectionId: scope.connectionId,
          externalRef: root,
        },
      },
      select: {
        artifact: true,
        conversation: { select: { caseId: true } },
      },
    })
  );
  return (
    anchor?.artifact === TEAMS_ASK_ANCHOR_ARTIFACT &&
    anchor.conversation.caseId === scope.caseId
  );
}
