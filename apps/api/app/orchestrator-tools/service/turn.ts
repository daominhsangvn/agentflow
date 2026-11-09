import type { IntegrationToolCallResponse } from "@repo/api/src/types/integration-tools";
import { OrchestratorApprovals } from "@repo/api/src/types/orchestrator";
import {
  type OrchestratorGrantSet,
  resolveOrchestratorGrants,
} from "@repo/api/src/types/orchestrator-grants";
import { withDb } from "@repo/database";
import { loadProjectConnectionRuntime } from "@/lib/integrations/project-connections";
import {
  type ConversationChannel,
  readChannel,
} from "@/lib/orchestrator/channel";
import type { OrchestratorWorkflow } from "@/lib/orchestrator/workflow-settings";
import { orchestratorCaseUrl } from "@/lib/workflows/engine/links";

/** What the orchestrator's tool modules share about one running turn. */

export type TurnContext = {
  turnId: string;
  organizationId: string;
  conversationId: string;
  projectId: string;
  caseId: string;
  projectConnectionId: string | null;
  channel: ConversationChannel | null;
  grants: OrchestratorGrantSet;
  workflowId: string;
  workflowName: string;
  features: OrchestratorToolFeatures;
};

export type ToolOutcome = IntegrationToolCallResponse;

export async function loadConversationConnection(context: TurnContext) {
  if (!context.projectConnectionId) {
    return null;
  }
  const loaded = await loadProjectConnectionRuntime(
    context.organizationId,
    context.projectConnectionId
  );
  return loaded?.connection ?? null;
}

/** The case's page in AgentFlow, for people to decide there. */
export async function caseLink(context: TurnContext): Promise<string | null> {
  const organization = await withDb((db) =>
    db.organization.findUnique({
      where: { id: context.organizationId },
      select: { slug: true },
    })
  );
  return organization?.slug
    ? orchestratorCaseUrl(organization.slug, context.caseId)
    : null;
}

export function refused(error: string): ToolOutcome {
  return { ok: false, error, retryable: false };
}

/** A tool whose grant is missing: `what` is e.g. "source: comment". */
export function notGranted(what: string): ToolOutcome {
  return refused(
    `${what} is not granted: add it under agent.orchestrator.connections (docs/orchestrator.md).`
  );
}

/** The opt-in side-conversation tools of the turn's workflow (agent.orchestrator). */
export type OrchestratorToolFeatures = {
  caseLookup: boolean;
  caseHandoff: boolean;
  /** agent.orchestrator.approvals = required: thread writes only from an approved draft. */
  approvalsRequired: boolean;
};

export type TurnConversation = {
  id: string;
  projectId: string;
  caseId: string;
  projectConnectionId: string | null;
  channel: unknown;
  case: { workflowId: string };
};

/** A turn's context from its conversation and its workflow's settings (undefined: not orchestrated any more). */
export function turnContextOf(
  turn: { id: string; organizationId: string },
  conversation: TurnConversation,
  workflow: OrchestratorWorkflow | undefined
): TurnContext {
  return {
    turnId: turn.id,
    organizationId: turn.organizationId,
    conversationId: conversation.id,
    projectId: conversation.projectId,
    caseId: conversation.caseId,
    projectConnectionId: conversation.projectConnectionId,
    channel: readChannel(conversation.channel),
    grants: resolveOrchestratorGrants(workflow?.connections),
    workflowId: conversation.case.workflowId,
    workflowName: workflow?.name ?? "",
    features: {
      caseLookup: workflow?.caseLookup ?? false,
      caseHandoff: workflow?.caseHandoff ?? false,
      approvalsRequired: workflow?.approvals === OrchestratorApprovals.Required,
    },
  };
}
