import { resolveOrchestratorGrants } from "@repo/api/src/types/orchestrator-grants";
import { Result } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  replyInTeamsAsk,
  teamsAskReplyInputSchema,
} from "@/app/orchestrator-tools/service/teams-ask-thread";
import type { TurnContext } from "@/app/orchestrator-tools/service/turn";

/** teams_ask_reply: ask lookup, grants, summary building, posting and recording. */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  askPost: null as Row | null,
  taskResult: null as Row | null,
  options: [] as Row[],
  postThreadReply: vi.fn(),
  createError: null as Error | null,
  deleted: [] as Row[],
  updated: [] as Row[],
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTask: {
      findFirst: () =>
        Promise.resolve(mocks.taskResult ? { result: mocks.taskResult } : null),
    },
    integrationDelivery: { findMany: () => Promise.resolve([]) },
    orchestratorConversation: {
      findMany: () => Promise.resolve([{ id: "conversation-1" }]),
    },
    orchestratorMessage: {
      findFirst: () => Promise.resolve(mocks.askPost),
      create: (args: { data: Row }) => {
        if (mocks.createError) {
          return Promise.reject(mocks.createError);
        }
        mocks.messages.push(args.data);
        return Promise.resolve({
          ...args.data,
          id: `row-${mocks.messages.length}`,
        });
      },
      deleteMany: (args: { where: Row }) => {
        mocks.deleted.push(args.where);
        mocks.messages.length = 0;
        return Promise.resolve({ count: 1 });
      },
      updateMany: (args: { where: Row; data: Row }) => {
        mocks.updated.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () =>
    Promise.resolve({
      connection: { record: { id: "conn-1" }, runtime: { secrets: {} } },
    }),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/lib/orchestrator/teams-ask-channels", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/orchestrator/teams-ask-channels")
  >()),
  loadTeamsAskChannels: () => Promise.resolve(mocks.options),
}));
vi.mock(
  "@/lib/integrations/providers/microsoft-teams/channel-ask",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/integrations/providers/microsoft-teams/channel-ask")
    >()),
    postTeamsAskThreadReply: mocks.postThreadReply,
  })
);

const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const MENTION = {
  email: "an@contoso.test",
  id: "29:an",
  aadObjectId: "aad-an",
  name: "An",
};
const OPTIONS = [
  {
    alias: "ba",
    channelId: "19:b@thread.tacv2",
    connectionKey: "teams",
    projectConnectionId: "pc-1",
  },
];

function turn(ask: string[] = ["teams"], features: Row = {}): TurnContext {
  return {
    turnId: "turn-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    caseId: "case-1",
    projectConnectionId: null,
    channel: { item: { key: "LD-7" } },
    grants: resolveOrchestratorGrants(ask.length > 0 ? { teams: ["ask"] } : {}),
    workflowId: "workflow-1",
    workflowName: "wf",
    features,
  } as unknown as TurnContext;
}

function input(extra: Record<string, unknown> = {}) {
  return teamsAskReplyInputSchema.parse({
    askRef: "root-1",
    text: "Thanks, one more thing.",
    ...extra,
  });
}

function askPost(connectionKey = "teams"): Row {
  return {
    id: "m-1",
    payload: {
      teamsAsk: {
        channelId: "19:b@thread.tacv2",
        connectionKey,
        mentions: [MENTION],
        questions: [{ taskId: TASK_ID, questionId: "q1" }],
      },
    },
  };
}

function continuedAsk(taskId: string): Row {
  const base = askPost();
  const payload = base.payload as { teamsAsk: Row };
  return {
    ...base,
    payload: {
      teamsAsk: {
        ...payload.teamsAsk,
        threadRef: "root-1",
        questions: [{ taskId, questionId: "q1" }],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.createError = null;
  mocks.deleted = [];
  mocks.updated = [];
  mocks.options = OPTIONS;
  mocks.askPost = askPost();
  mocks.taskResult = {
    reply: null,
    error: null,
    questions: [{ id: "q1", question: "Which timeout?" }],
  };
  mocks.postThreadReply.mockResolvedValue(
    Result.ok({ messageId: "reply-1", mentions: [MENTION] })
  );
});

describe("teams_ask_reply", () => {
  it("is refused without an ask grant", async () => {
    const result = await replyInTeamsAsk(turn([]), input());
    expect(result).toMatchObject({ ok: false });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("refuses an askRef that is not an ask post", async () => {
    mocks.askPost = null;
    const result = await replyInTeamsAsk(turn(), input());
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("askRef"),
    });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("refuses an ask whose connection key is no longer granted", async () => {
    mocks.askPost = askPost("other");
    const result = await replyInTeamsAsk(turn(), input());
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("other: ask"),
    });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("posts a discussion reply with no mentions", async () => {
    const result = await replyInTeamsAsk(turn(), input());
    expect(result).toMatchObject({
      ok: true,
      output: { posted: true, awaitingConfirmation: false, askRef: "root-1" },
    });
    expect(mocks.postThreadReply.mock.calls[0]?.[1]).toMatchObject({
      emails: [],
      rootMessageId: "root-1",
      channelId: "19:b@thread.tacv2",
    });
    expect(mocks.messages[0]).toMatchObject({
      externalRef: "reply-1",
      payload: { teamsAskReply: { askRef: "root-1", summary: null } },
    });
  });

  it("refuses answers for an unknown question id", async () => {
    const result = await replyInTeamsAsk(
      turn(),
      input({ answers: [{ questionId: "zz", answer: "30s" }] })
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("q1"),
    });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("defaults mentions to the asked people and records the summary", async () => {
    const result = await replyInTeamsAsk(
      turn(),
      input({ answers: [{ questionId: "q1", answer: "30s" }] })
    );
    expect(result).toMatchObject({
      ok: true,
      output: { awaitingConfirmation: true },
    });
    const post = mocks.postThreadReply.mock.calls[0]?.[1];
    expect(post.emails).toEqual(["an@contoso.test"]);
    expect(post.text).toContain("Which timeout? → 30s");
    expect(mocks.updated[0]?.data).toMatchObject({ externalRef: "reply-1" });
    expect(mocks.messages[0]).toMatchObject({
      payload: {
        teamsAskReply: {
          summary: [
            {
              taskId: TASK_ID,
              questionId: "q1",
              question: "Which timeout?",
              answer: "30s",
            },
          ],
        },
      },
    });
  });

  it("refuses a post that would not fit in Teams", async () => {
    const result = await replyInTeamsAsk(
      turn(),
      input({
        answers: [{ questionId: "q1", answer: "x".repeat(4000) }],
        text: "y".repeat(19_000),
      })
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("Too long"),
    });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("returns the post failure as given and records nothing", async () => {
    mocks.postThreadReply.mockResolvedValue(
      Result.err({ error: "Teams is busy", retryable: true })
    );
    const result = await replyInTeamsAsk(turn(), input());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(mocks.messages).toHaveLength(0);
  });

  it("stores a summary before posting and removes it when the post fails", async () => {
    mocks.postThreadReply.mockImplementation(() => {
      expect(mocks.messages).toHaveLength(1);
      return Promise.resolve(
        Result.err({ error: "Teams is busy", retryable: true })
      );
    });
    const result = await replyInTeamsAsk(
      turn(),
      input({ answers: [{ questionId: "q1", answer: "30s" }] })
    );
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(mocks.deleted).toEqual([{ id: "row-1", organizationId: "org-1" }]);
    expect(mocks.messages).toHaveLength(0);
  });

  it("posts nothing when the summary cannot be stored", async () => {
    mocks.createError = new Error("db down");
    const result = await replyInTeamsAsk(
      turn(),
      input({ answers: [{ questionId: "q1", answer: "30s" }] })
    );
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(mocks.postThreadReply).not.toHaveBeenCalled();
  });

  it("replies to a continued ask in the thread root", async () => {
    mocks.askPost = continuedAsk("task-2");
    const result = await replyInTeamsAsk(turn(), input({ askRef: "reply-2" }));
    expect(result).toMatchObject({
      ok: true,
      output: { askRef: "reply-2", threadRef: "root-1" },
    });
    expect(mocks.postThreadReply.mock.calls[0]?.[1]).toMatchObject({
      rootMessageId: "root-1",
    });
    expect(mocks.messages[0]).toMatchObject({
      payload: { teamsAskReply: { askRef: "reply-2", threadRef: "root-1" } },
    });
  });

  it("answers are checked against the ask's own task", async () => {
    mocks.askPost = continuedAsk("task-2");
    const result = await replyInTeamsAsk(
      turn(),
      input({
        askRef: "reply-2",
        answers: [{ questionId: "q1", answer: "30s" }],
      })
    );
    expect(result).toMatchObject({ ok: true });
    expect(mocks.messages[0]).toMatchObject({
      payload: {
        teamsAskReply: { summary: [{ taskId: "task-2", questionId: "q1" }] },
      },
    });
    const refused = await replyInTeamsAsk(
      turn(),
      input({
        askRef: "reply-2",
        answers: [{ questionId: "q2", answer: "30s" }],
      })
    );
    expect(refused).toMatchObject({
      ok: false,
      error: expect.stringContaining("q2"),
    });
  });

  it("is allowed when approvals are required", async () => {
    const result = await replyInTeamsAsk(
      turn(["teams"], { approvalsRequired: true }),
      input()
    );
    expect(result).toMatchObject({ ok: true });
  });
});
