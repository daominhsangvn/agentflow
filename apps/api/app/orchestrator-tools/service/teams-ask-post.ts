import { OrchestratorMessageOrigin } from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import {
  readTeamsAsk,
  type TeamsAskPayload,
} from "@/lib/orchestrator/teams-ask";
import { caseConversationIds } from "@/lib/orchestrator/teams-ask-threads";

/** The ask post (the teams_ask message) of a case by its askRef; any conversation of the case. */
export async function findTeamsAskPost(
  scope: { organizationId: string; caseId: string },
  askRef: string
): Promise<{ id: string; ask: TeamsAskPayload } | null> {
  const conversationIds = await caseConversationIds(scope);
  const message = await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        organizationId: scope.organizationId,
        conversationId: { in: conversationIds },
        externalRef: askRef,
        origin: OrchestratorMessageOrigin.Internal,
      },
      select: { id: true, payload: true },
    })
  );
  const ask = readTeamsAsk(message?.payload);
  return message && ask ? { id: message.id, ask } : null;
}
