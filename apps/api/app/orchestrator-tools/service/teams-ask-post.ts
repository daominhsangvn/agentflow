import { OrchestratorMessageOrigin } from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import {
  readTeamsAsk,
  type TeamsAskPayload,
} from "@/lib/orchestrator/teams-ask";

/** The ask post (the teams_ask message) of a conversation by its root message id. */
export async function findTeamsAskPost(
  scope: { organizationId: string; conversationId: string },
  askRef: string
): Promise<{ id: string; ask: TeamsAskPayload } | null> {
  const message = await withDb((db) =>
    db.orchestratorMessage.findFirst({
      where: {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        externalRef: askRef,
        origin: OrchestratorMessageOrigin.Internal,
      },
      select: { id: true, payload: true },
    })
  );
  const ask = readTeamsAsk(message?.payload);
  return message && ask ? { id: message.id, ask } : null;
}
