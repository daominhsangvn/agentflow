import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ID,
  createOrchestratorDbFake,
  ORG_ID,
  type OrchestratorDbFake,
} from "@/__tests__/support/orchestrator/orchestrator-db.test-fake";
import { TEAMS_ASK_ANCHOR_ARTIFACT } from "@/lib/orchestrator/teams-ask";
import {
  findCaseAskThread,
  findThreadAsks,
  pickThreadAsk,
  type ThreadAsk,
} from "@/lib/orchestrator/teams-ask-threads";

const mocks = vi.hoisted(() => ({ fake: null as OrchestratorDbFake | null }));

vi.mock("@repo/database", () => {
  const withDb = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  withDb.tx = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  return { withDb };
});

const ROOT = "root-1";
const CHANNEL = "19:qa@thread.tacv2";
const MENTIONS = [
  { email: "an@x.test", id: "29:an", aadObjectId: null, name: "An" },
];

let fake: OrchestratorDbFake;
let seq = 0;

beforeEach(() => {
  fake = createOrchestratorDbFake();
  mocks.fake = fake;
  seq = 0;
  fake.conversations.push(
    { id: "c-1", organizationId: ORG_ID, caseId: "case-1" },
    { id: "c-2", organizationId: ORG_ID, caseId: "case-1" },
    { id: "c-other", organizationId: ORG_ID, caseId: "case-2" }
  );
});

function addAsk(
  conversationId: string,
  externalRef: string,
  extras: {
    threadRef?: string;
    channelId?: string;
    connectionKey?: string;
  } = {}
) {
  seq += 1;
  fake.messages.push({
    id: `m-${seq}`,
    conversationId,
    organizationId: ORG_ID,
    origin: OrchestratorMessageOrigin.Internal,
    externalRef,
    createdAt: new Date(Date.UTC(2026, 9, 23, 8, 0, seq)),
    payload: {
      teamsAsk: {
        channelId: extras.channelId ?? CHANNEL,
        connectionKey: extras.connectionKey,
        threadRef: extras.threadRef,
        mentions: MENTIONS,
        questions: [{ taskId: "task-1", questionId: "q1" }],
      },
    },
  });
}

function addRecorded(conversationId: string, askRef: string) {
  seq += 1;
  fake.messages.push({
    id: `m-${seq}`,
    conversationId,
    organizationId: ORG_ID,
    kind: OrchestratorMessageKind.AnswersRecorded,
    createdAt: new Date(Date.UTC(2026, 9, 23, 8, 0, seq)),
    payload: { teamsAskConfirm: { askRef } },
  });
}

function threadAsk(askRef: string, recorded: boolean): ThreadAsk {
  return {
    messageId: `m-${askRef}`,
    askRef,
    createdAt: new Date(),
    ask: { channelId: CHANNEL, mentions: MENTIONS, questions: [] },
    recorded,
  };
}

describe("pickThreadAsk", () => {
  it("prefers the newest open ask", () => {
    const asks = [
      threadAsk("c", true),
      threadAsk("b", false),
      threadAsk("a", false),
    ];
    expect(pickThreadAsk(asks)?.askRef).toBe("b");
  });

  it("falls back to the newest ask when all are recorded", () => {
    const asks = [threadAsk("b", true), threadAsk("a", true)];
    expect(pickThreadAsk(asks)?.askRef).toBe("b");
  });

  it("prefers the newest open ask that mentions the writer", () => {
    const other = threadAsk("b", false);
    other.ask = { ...other.ask, mentions: [] };
    const asks = [other, threadAsk("a", false)];
    expect(pickThreadAsk(asks, "29:an")?.askRef).toBe("a");
    expect(pickThreadAsk(asks, "29:zed")?.askRef).toBe("b");
  });

  it("returns null without asks", () => {
    expect(pickThreadAsk([])).toBeNull();
  });
});

describe("findThreadAsks", () => {
  it("finds the root and later asks across the case's conversations", async () => {
    addAsk("c-1", ROOT);
    addAsk("c-2", "reply-2", { threadRef: ROOT });
    addAsk("c-other", ROOT);
    addRecorded("c-2", ROOT);

    const asks = await findThreadAsks(
      { organizationId: ORG_ID, caseId: "case-1" },
      ROOT
    );

    expect(asks.map((ask) => [ask.askRef, ask.recorded])).toEqual([
      ["reply-2", false],
      [ROOT, true],
    ]);
  });
});

describe("findCaseAskThread", () => {
  const scope = {
    organizationId: ORG_ID,
    caseId: "case-1",
    connectionId: CONNECTION_ID,
  };
  const channel = { channelId: CHANNEL, connectionKey: "teams" };

  it("returns the root for the same channel", async () => {
    addAsk("c-1", ROOT);
    addAsk("c-1", "reply-2", { threadRef: ROOT });
    fake.addAnchor("c-1", "microsoft_teams", ROOT, {
      artifact: TEAMS_ASK_ANCHOR_ARTIFACT,
    });

    expect(await findCaseAskThread(scope, channel)).toBe(ROOT);
  });

  it("returns null for another channel", async () => {
    addAsk("c-1", ROOT);
    fake.addAnchor("c-1", "microsoft_teams", ROOT, {
      artifact: TEAMS_ASK_ANCHOR_ARTIFACT,
    });

    expect(
      await findCaseAskThread(scope, { ...channel, channelId: "19:other" })
    ).toBeNull();
  });

  it("returns null when the anchor is missing", async () => {
    addAsk("c-1", ROOT);

    expect(await findCaseAskThread(scope, channel)).toBeNull();
  });
});
