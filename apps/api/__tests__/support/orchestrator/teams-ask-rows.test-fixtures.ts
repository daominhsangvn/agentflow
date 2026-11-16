import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { ORG_ID } from "./orchestrator-db.test-fake";

/** A continued ask (reply-2, task-2, mentions Binh) in the thread of `threadRef`, plus recorded asks. */
export function continuedAskRows(
  conversationId: string,
  threadRef: string,
  recordedRefs: string[]
) {
  const base = { conversationId, organizationId: ORG_ID };
  const ask = {
    ...base,
    id: "ask-message-2",
    origin: OrchestratorMessageOrigin.Internal,
    externalRef: "reply-2",
    dedupKey: "teams_ask:turn:reply-2",
    createdAt: new Date(Date.now() + 1000),
    payload: {
      teamsAsk: {
        channelId: "19:qa@thread.tacv2",
        threadRef,
        mentions: [
          {
            email: "binh@x.test",
            id: "29:binh",
            aadObjectId: "aad-binh",
            name: "Binh",
          },
        ],
        questions: [{ taskId: "task-2", questionId: "q1" }],
      },
    },
  };
  const recorded = recordedRefs.map((askRef) => ({
    ...base,
    id: `recorded-${askRef}`,
    origin: OrchestratorMessageOrigin.Internal,
    kind: OrchestratorMessageKind.AnswersRecorded,
    dedupKey: `recorded:${askRef}`,
    createdAt: new Date(),
    payload: { teamsAskConfirm: { askRef } },
  }));
  return [ask, ...recorded];
}
