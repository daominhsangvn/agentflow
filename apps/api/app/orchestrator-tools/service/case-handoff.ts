import {
  ORCHESTRATOR_DEBOUNCE_SECONDS_DEFAULT,
  OrchestratorCaseStatus,
  OrchestratorDecisionStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { advanceConversation } from "@/lib/orchestrator/advance";
import { channelKeyFor } from "@/lib/orchestrator/channel";
import { loadOrchestratorWorkflows } from "@/lib/orchestrator/workflow-settings";
import { waitUntil } from "@/lib/wait-until";
import { findItemCases, type ItemCase, itemKeySchema } from "./case-lookup";
import { caseLink, refused, type ToolOutcome, type TurnContext } from "./turn";

/**
 * case_handoff: sends the summary people approved (the question of an approved
 * decision of this case, copied here, never taken from the model) to the case
 * of another item of the project as a `handoff` message that wakes it
 * (docs/orchestrator.md).
 */

const PRISMA_UNIQUE_VIOLATION = "P2002";

export const caseHandoffInputSchema = z.object({
  decisionId: z.uuid(),
  itemKey: itemKeySchema,
  caseId: z.uuid().optional(),
});

type CaseHandoffInput = z.infer<typeof caseHandoffInputSchema>;

type ApprovedDecision = {
  id: string;
  conversationId: string;
  question: string;
  decidedBy: string | null;
};

export async function handOffCase(
  context: TurnContext,
  input: CaseHandoffInput
): Promise<ToolOutcome> {
  if (!context.features.caseHandoff) {
    return refused(
      "case_handoff is off for this workflow: agent.orchestrator.caseHandoff (docs/orchestrator.md)."
    );
  }
  const { itemKey, decisionId } = input;
  if (context.channel?.item.key.toLowerCase() === itemKey.toLowerCase()) {
    return refused(
      `${itemKey} is this conversation's own item: case_handoff sends to another item's case.`
    );
  }
  const loaded = await loadApprovedDecision(context, decisionId);
  if (typeof loaded === "string") {
    return refused(loaded);
  }
  const picked = await pickTarget(context, input);
  if (typeof picked === "string") {
    return refused(picked);
  }
  const target = await findTargetConversation(context, picked);
  if (!target) {
    return refused(`The case of ${itemKey} has no conversation.`);
  }
  const settings = (
    await loadOrchestratorWorkflows(context.organizationId, [picked.workflowId])
  ).get(picked.workflowId);
  const debounceSeconds =
    settings?.debounceSeconds ?? ORCHESTRATOR_DEBOUNCE_SECONDS_DEFAULT;
  const created = await createHandoff(context, {
    decision: loaded,
    itemKey,
    target: picked,
    targetConversationId: target,
    debounceSeconds,
  });
  if (!created) {
    return refused(alreadyHandedOff(decisionId));
  }
  if (debounceSeconds === 0 && settings?.enabled) {
    waitUntil(advanceConversation(target));
  }
  return {
    ok: true,
    output: {
      sentTo: itemKey,
      caseId: picked.id,
      caseUrl: await caseLink({ ...context, caseId: picked.id }),
      reopened: picked.status === OrchestratorCaseStatus.Closed,
      next: `Tell this thread it was sent to ${itemKey} with the case link, then wait_human.`,
    },
  };
}

/** The decision of this case, approved and not yet handed off; else the refusal. */
async function loadApprovedDecision(
  context: TurnContext,
  decisionId: string
): Promise<ApprovedDecision | string> {
  const decision = await withDb((db) =>
    db.orchestratorDecision.findFirst({
      where: {
        id: decisionId,
        organizationId: context.organizationId,
        caseId: context.caseId,
      },
      select: {
        id: true,
        conversationId: true,
        question: true,
        status: true,
        decidedBy: true,
      },
    })
  );
  if (!decision) {
    return "No decision of this case has that id.";
  }
  if (decision.status !== OrchestratorDecisionStatus.Approved) {
    return `Decision ${decision.id} is ${decision.status}: hand off only a summary people approved (request_decision, then wait_human).`;
  }
  const sent = await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        organizationId: context.organizationId,
        conversationId: decision.conversationId,
        dedupKey: handoffDedupKey(decision.id),
      },
      select: { id: true },
    })
  );
  return sent ? alreadyHandedOff(decision.id) : decision;
}

/** The case that receives the handoff; else the refusal. */
async function pickTarget(
  context: TurnContext,
  input: CaseHandoffInput
): Promise<ItemCase | string> {
  const { itemKey, caseId } = input;
  const found = await findItemCases(context, itemKey);
  if (found.length === 0) {
    return `No case of this project is about ${itemKey}: it gets one when a trigger of an orchestrated workflow matches that item.`;
  }
  if (caseId) {
    const chosen = found.find((item) => item.id === caseId);
    return (
      chosen ??
      `${caseId} is not a case about ${itemKey}; cases: ${listCases(found)}`
    );
  }
  if (found.length > 1) {
    return `Several cases are about ${itemKey}; call again with caseId, one of: ${listCases(found)}`;
  }
  return found[0];
}

async function findTargetConversation(
  context: TurnContext,
  target: ItemCase
): Promise<string | null> {
  const conversations = await withDb((db) =>
    db.orchestratorConversation.findMany({
      where: { organizationId: context.organizationId, caseId: target.id },
      select: { id: true, channelKey: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    })
  );
  const wanted = channelKeyFor(itemRefOf(target.sourceKey), null);
  const match = conversations.find((c) => c.channelKey === wanted);
  return (match ?? conversations[0])?.id ?? null;
}

type HandoffInput = {
  decision: ApprovedDecision;
  itemKey: string;
  target: ItemCase;
  targetConversationId: string;
  debounceSeconds: number;
};

/** Stores both messages; false when the decision was already handed off. */
async function createHandoff(
  context: TurnContext,
  input: HandoffInput
): Promise<boolean> {
  const { decision, itemKey, target, targetConversationId } = input;
  const { channel } = context;
  const dedupKey = handoffDedupKey(decision.id);
  try {
    await withDb.tx(async (tx) => {
      await tx.orchestratorMessage.create({
        data: {
          organizationId: context.organizationId,
          conversationId: decision.conversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.HandoffSent,
          actor: decision.decidedBy,
          text: `Sent to ${itemKey} (case ${target.id}): decision ${decision.id}`,
          externalRef: null,
          dedupKey,
          turnId: context.turnId,
          payload: {
            toCaseId: target.id,
            toConversationId: targetConversationId,
            decisionId: decision.id,
          },
        },
      });
      await tx.orchestratorMessage.create({
        data: {
          organizationId: context.organizationId,
          conversationId: targetConversationId,
          origin: OrchestratorMessageOrigin.Internal,
          kind: OrchestratorMessageKind.Handoff,
          actor: decision.decidedBy,
          text: `Confirmed change request from a side conversation${fromLabel(channel)}, approved by ${decision.decidedBy ?? "someone"}:\n\n${decision.question}`,
          externalRef: null,
          dedupKey,
          payload: {
            fromCaseId: context.caseId,
            fromConversationId: context.conversationId,
            fromUrl: channel?.item.url ?? null,
            decisionId: decision.id,
            approvedBy: decision.decidedBy,
          },
        },
      });
      await tx.orchestratorConversation.updateMany({
        where: {
          id: targetConversationId,
          organizationId: context.organizationId,
        },
        data: {
          nextWakeAt: new Date(Date.now() + input.debounceSeconds * 1000),
        },
      });
      await tx.orchestratorCase.updateMany({
        where: {
          id: target.id,
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

function fromLabel(channel: TurnContext["channel"]): string {
  if (!channel) {
    return "";
  }
  const { item } = channel;
  const place = item.url
    ? `${item.title ?? item.key}, ${item.url}`
    : (item.title ?? item.key);
  return ` (${place})`;
}

function handoffDedupKey(decisionId: string): string {
  return `handoff:${decisionId}`;
}

function alreadyHandedOff(decisionId: string): string {
  return `Decision ${decisionId} was already handed off; ask for a new decision for new changes.`;
}

function listCases(cases: ItemCase[]): string {
  return cases
    .map((item) => `${item.id} (${item.workflowName}, ${item.status})`)
    .join(", ");
}

/** The provider and key of a case's source item, split at the first colon. */
function itemRefOf(sourceKey: string | null): {
  provider: string;
  key: string;
} {
  const value = sourceKey ?? "";
  const colon = value.indexOf(":");
  if (colon < 0) {
    return { provider: "", key: value };
  }
  return { provider: value.slice(0, colon), key: value.slice(colon + 1) };
}
