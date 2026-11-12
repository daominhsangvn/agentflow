import { OrchestratorToolName } from "@repo/api/src/types/orchestrator";
import { resolveOrchestratorGrants } from "@repo/api/src/types/orchestrator-grants";
import { Result } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askInTeams,
  teamsAskInputSchema,
} from "@/app/orchestrator-tools/service/teams-ask";
import type { TurnContext } from "@/app/orchestrator-tools/service/turn";

/** teams_ask: channel choice, question checks, posting and recording. */

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  anchors: [] as Row[],
  deliveries: [] as Row[],
  taskResult: {
    reply: null,
    error: null,
    questions: [{ id: "q1", question: "?" }],
  } as Row | null,
  options: [] as Row[],
  postTeamsAsk: vi.fn(),
  findCaseTaskFiles: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTask: {
      findFirst: () =>
        Promise.resolve(mocks.taskResult ? { result: mocks.taskResult } : null),
    },
    integrationDelivery: {
      findMany: () => Promise.resolve(mocks.deliveries),
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    orchestratorAnchor: {
      create: (args: { data: Row }) => {
        mocks.anchors.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
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
    postTeamsAsk: mocks.postTeamsAsk,
  })
);
vi.mock("@/lib/orchestrator/task-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/task-files")>()),
  findCaseTaskFiles: mocks.findCaseTaskFiles,
}));

const OPTIONS = [
  {
    alias: "qa-backend",
    channelId: "19:a@thread.tacv2",
    connectionKey: "teams",
    projectConnectionId: "pc-1",
  },
  {
    alias: "ba",
    channelId: "19:b@thread.tacv2",
    connectionKey: "teams",
    projectConnectionId: "pc-1",
  },
];
const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const MENTION = {
  email: "an@contoso.test",
  id: "29:an",
  aadObjectId: "aad-an",
  name: "An",
};

function turn(ask: string[] = ["teams"]): TurnContext {
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
    features: {},
  } as unknown as TurnContext;
}

function input(extra: Record<string, unknown> = {}) {
  return teamsAskInputSchema.parse({
    mentions: ["An@Contoso.test"],
    text: "Which timeout?",
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.anchors = [];
  mocks.deliveries = [];
  mocks.options = OPTIONS;
  mocks.taskResult = {
    reply: null,
    error: null,
    questions: [{ id: "q1", question: "?" }],
  };
  mocks.findCaseTaskFiles.mockResolvedValue(Result.ok([]));
  mocks.postTeamsAsk.mockResolvedValue(
    Result.ok({
      rootMessageId: "root-1",
      conversationId: "c",
      mentions: [MENTION],
    })
  );
});

describe("teams_ask", () => {
  it("is refused without an ask grant", async () => {
    const result = await askInTeams(turn([]), input({ channel: "ba" }));
    expect(result).toMatchObject({ ok: false });
    expect(mocks.postTeamsAsk).not.toHaveBeenCalled();
  });

  it("is refused when there is no ask channel", async () => {
    mocks.options = [];
    const result = await askInTeams(turn(), input());
    expect(result).toMatchObject({ ok: false });
    expect(mocks.postTeamsAsk).not.toHaveBeenCalled();
  });

  it("posts to the named channel, lower-casing the emails", async () => {
    const result = await askInTeams(turn(), input({ channel: "qa-backend" }));
    expect(result).toMatchObject({
      ok: true,
      output: { posted: true, channel: "qa-backend", mentioned: ["An"] },
    });
    expect(mocks.postTeamsAsk.mock.calls[0]?.[1]).toMatchObject({
      channelId: "19:a@thread.tacv2",
      emails: ["an@contoso.test"],
    });
  });

  it("refuses an unknown channel listing the allowed ones", async () => {
    const result = await askInTeams(turn(), input({ channel: "devops" }));
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("qa-backend (teams), ba (teams)"),
    });
    expect(mocks.postTeamsAsk).not.toHaveBeenCalled();
  });

  it("requires a channel when there are two, not when there is one", async () => {
    expect(await askInTeams(turn(), input())).toMatchObject({ ok: false });
    mocks.options = [OPTIONS[1] as Row];
    expect(await askInTeams(turn(), input())).toMatchObject({ ok: true });
  });

  it("refuses questions of two tasks and unknown question ids", async () => {
    const two = await askInTeams(
      turn(),
      input({
        channel: "ba",
        questions: [
          { taskId: "t1", questionId: "q1" },
          { taskId: "t2", questionId: "q1" },
        ],
      })
    );
    const unknown = await askInTeams(
      turn(),
      input({
        channel: "ba",
        questions: [{ taskId: TASK_ID, questionId: "zz" }],
      })
    );
    expect(two).toMatchObject({ ok: false });
    expect(unknown).toMatchObject({
      ok: false,
      error: expect.stringContaining("q1"),
    });
    expect(mocks.postTeamsAsk).not.toHaveBeenCalled();
  });

  it("records the message and a teams_ask anchor", async () => {
    const attachments = [{ taskId: TASK_ID, name: "plan.md" }];
    mocks.findCaseTaskFiles.mockResolvedValue(Result.ok([{ name: "plan.md" }]));
    await askInTeams(
      turn(),
      input({
        channel: "ba",
        attachments,
        questions: [{ taskId: TASK_ID, questionId: "q1" }],
      })
    );
    expect(mocks.messages[0]).toMatchObject({
      externalRef: "root-1",
      payload: {
        teamsAsk: { channelId: "19:b@thread.tacv2", mentions: [MENTION] },
        attachments,
      },
    });
    expect(mocks.anchors[0]).toMatchObject({
      artifact: "teams_ask",
      externalRef: "root-1",
      taskId: TASK_ID,
      questionId: "q1",
    });
  });

  it("uses the global service URL without deliveries, else the delivery's", async () => {
    await askInTeams(turn(), input({ channel: "ba" }));
    expect(mocks.postTeamsAsk.mock.calls[0]?.[1].serviceUrl.href).toBe(
      "https://smba.trafficmanager.net/teams"
    );
    mocks.deliveries = [
      { payload: { serviceUrl: "https://smba.trafficmanager.net/emea/" } },
    ];
    await askInTeams(turn(), input({ channel: "ba" }));
    expect(mocks.postTeamsAsk.mock.calls[1]?.[1].serviceUrl.href).toContain(
      "/emea"
    );
  });

  it("returns the post failure with its retryable flag", async () => {
    mocks.postTeamsAsk.mockResolvedValue(
      Result.err({ error: "Teams is busy", retryable: true })
    );
    const result = await askInTeams(turn(), input({ channel: "ba" }));
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(mocks.messages).toHaveLength(0);
  });

  it("names the tool", () => {
    expect(OrchestratorToolName.TeamsAsk).toBe("teams_ask");
  });
});
