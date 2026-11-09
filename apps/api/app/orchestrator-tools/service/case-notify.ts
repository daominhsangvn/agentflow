import { createHash } from "node:crypto";
import {
  OrchestratorCaseStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { advanceConversation } from "@/lib/orchestrator/advance";
import { caseSourceKey, channelKeyFor } from "@/lib/orchestrator/channel";
import { loadOrchestratorWorkflows } from "@/lib/orchestrator/workflow-settings";
import { waitUntil } from "@/lib/wait-until";
import { refused, type ToolOutcome, type TurnContext } from "./turn";

/**
 * case_notify: notifies another case of this workflow, e.g. the items a
 * resolved blocker blocks (docs/orchestrator.md). The message is internal, so
 * it wakes the target's next turn after its debounce, reopens a closed case
 * and queues behind a running turn.
 */

const PRISMA_UNIQUE_VIOLATION = "P2002";

export const NOTIFY_MESSAGE_MAX = 4000;

export const caseNotifyInputSchema = z.object({
  itemKey: z.string().trim().min(1).max(255),
  message: z.string().trim().min(1).max(NOTIFY_MESSAGE_MAX),
});

type CaseNotifyInput = z.infer<typeof caseNotifyInputSchema>;

export async function notifyCase(
  context: TurnContext,
  input: CaseNotifyInput
): Promise<ToolOutcome> {
  const { channel } = context;
  if (!channel) {
    return refused(
      "This conversation has no source item, so it has no other case to notify."
    );
  }
  const { itemKey, message } = input;
  const fromKey = channel.item.key;
  if (itemKey.toLowerCase() === fromKey.trim().toLowerCase()) {
    return refused(selfRefusal(itemKey));
  }
  const ref = { provider: channel.item.provider, key: itemKey };
  const target = await findTargetCase(context, ref);
  if (!target) {
    return refused(
      `No case of this workflow is about ${itemKey}: it gets one when a trigger of this workflow matches that item.`
    );
  }
  if (target.id === context.caseId) {
    return refused(selfRefusal(itemKey));
  }
  const targetRef = { ...ref, key: targetKeyOf(target.sourceKey, ref) };
  const conversationId = await findTargetConversation(
    context,
    target.id,
    targetRef
  );
  if (!conversationId) {
    return refused(`The case of ${itemKey} has no conversation to notify.`);
  }
  const settings = (
    await loadOrchestratorWorkflows(context.organizationId, [
      context.workflowId,
    ])
  ).get(context.workflowId);
  const debounceSeconds = settings?.debounceSeconds ?? 0;
  const text = `${fromKey}${titleSuffix(channel.item.title)} notifies this case: ${message}`;
  const created = await createNotice(context, {
    conversationId,
    targetId: target.id,
    debounceSeconds,
    text,
    message,
    fromKey,
    fromUrl: channel.item.url,
  });
  if (created && debounceSeconds === 0) {
    waitUntil(advanceConversation(conversationId));
  }
  return {
    ok: true,
    output: {
      notified: itemKey,
      caseId: target.id,
      reopened: created && target.status === OrchestratorCaseStatus.Closed,
      next: "That case's orchestrator gets the message in its next turn; nothing to wait for here.",
    },
  };
}

type NoticeInput = {
  conversationId: string;
  targetId: string;
  debounceSeconds: number;
  text: string;
  message: string;
  fromKey: string;
  fromUrl: string | null;
};

/** Stores the notice; false when this turn already sent the same one. */
async function createNotice(
  context: TurnContext,
  input: NoticeInput
): Promise<boolean> {
  const { conversationId, targetId, debounceSeconds, text, message } = input;
  const digest = createHash("sha256")
    .update(`${conversationId}\n${message}`)
    .digest("hex")
    .slice(0, 32);
  try {
    await withDb.tx(async (tx) => {
      await tx.orchestratorMessage.create({
        data: {
          organizationId: context.organizationId,
          conversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.CaseNotify,
          actor: input.fromKey,
          text,
          externalRef: null,
          dedupKey: `notify:${context.turnId}:${digest}`,
          payload: {
            fromCaseId: context.caseId,
            fromItem: input.fromKey,
            fromUrl: input.fromUrl,
            fromTurnId: context.turnId,
          },
        },
      });
      await tx.orchestratorConversation.updateMany({
        where: { id: conversationId, organizationId: context.organizationId },
        data: { nextWakeAt: new Date(Date.now() + debounceSeconds * 1000) },
      });
      await tx.orchestratorCase.updateMany({
        where: {
          id: targetId,
          organizationId: context.organizationId,
          status: OrchestratorCaseStatus.Closed,
        },
        data: { status: OrchestratorCaseStatus.Open, closedAt: null },
      });
    });
  } catch (error) {
    if (getPrismaErrorCode(error) === PRISMA_UNIQUE_VIOLATION) {
      return false;
    }
    throw error;
  }
  return true;
}

function targetKeyOf(sourceKey: string | null, ref: ItemRef): string {
  const prefix = `${ref.provider}:`;
  return sourceKey?.startsWith(prefix)
    ? sourceKey.slice(prefix.length)
    : ref.key;
}

function selfRefusal(itemKey: string): string {
  return `${itemKey} is this case's own item: case_notify is for another item's case (e.g. one in blocks).`;
}

function titleSuffix(title: string | null): string {
  return title ? ` (${title})` : "";
}

type ItemRef = { provider: string; key: string };

async function findTargetCase(context: TurnContext, ref: ItemRef) {
  return await withDb((db) =>
    db.orchestratorCase.findFirst({
      where: {
        organizationId: context.organizationId,
        workflowId: context.workflowId,
        sourceKey: { equals: caseSourceKey(ref), mode: "insensitive" },
      },
      select: { id: true, status: true, sourceKey: true },
    })
  );
}

async function findTargetConversation(
  context: TurnContext,
  caseId: string,
  ref: ItemRef
): Promise<string | null> {
  const conversations = await withDb((db) =>
    db.orchestratorConversation.findMany({
      where: {
        organizationId: context.organizationId,
        caseId,
        projectConnectionId: context.projectConnectionId,
      },
      select: { id: true, channelKey: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  );
  const wanted = channelKeyFor(ref, null);
  const match = conversations.find((c) => c.channelKey === wanted);
  return (match ?? conversations[0])?.id ?? null;
}
