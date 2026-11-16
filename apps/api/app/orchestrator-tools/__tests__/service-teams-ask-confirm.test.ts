import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { resolveOrchestratorGrants } from "@repo/api/src/types/orchestrator-grants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmTeamsAskAnswers,
  teamsAskConfirmInputSchema,
} from "@/app/orchestrator-tools/service/teams-ask-confirm";
import type { TurnContext } from "@/app/orchestrator-tools/service/turn";

/** teams_ask_confirm: guards, recording and question counting. */

type Row = Record<string, unknown> & {
  id: string;
  createdAt: Date;
  payload?: Record<string, unknown>;
};
type Where = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  task: { openQuestionCount: 2 },
  seq: 0,
}));

function pathValue(payload: unknown, path: string[]): unknown {
  let value: unknown = payload;
  for (const key of path) {
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  return value;
}

function matches(row: Row, where: Where): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "id") {
      const not = (expected as { not?: string }).not;
      if (not !== undefined && row.id === not) {
        return false;
      }
    } else if (key === "payload") {
      const { path, equals } = expected as { path: string[]; equals: unknown };
      if (pathValue(row.payload, path) !== equals) {
        return false;
      }
    } else if (row[key] !== expected) {
      return false;
    }
  }
  return true;
}

vi.mock("@repo/database", () => {
  const db = {
    orchestratorMessage: {
      findMany: (args: {
        where: Where;
        orderBy?: { createdAt: "desc" };
        take?: number;
      }) => {
        let rows = mocks.messages.filter((row) => matches(row, args.where));
        if (args.orderBy) {
          rows = [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
          );
        }
        return Promise.resolve(rows.slice(0, args.take ?? rows.length));
      },
      findFirst: (args: { where: Where }) =>
        Promise.resolve(
          mocks.messages.find((row) => matches(row, args.where)) ?? null
        ),
      create: (args: { data: Record<string, unknown> }) => {
        if (mocks.messages.some((row) => row.dedupKey === args.data.dedupKey)) {
          return Promise.reject({ code: "P2002" });
        }
        mocks.seq += 1;
        const row = {
          ...args.data,
          id: `created-${mocks.seq}`,
          createdAt: new Date(2026, 0, 1, 12, mocks.seq),
        } as Row;
        mocks.messages.push(row);
        return Promise.resolve(row);
      },
    },
    orchestratorTask: {
      findFirst: () => Promise.resolve({ ...mocks.task }),
      updateMany: (args: {
        where: { openQuestionCount?: { gte?: number; gt?: number } };
        data: { openQuestionCount: number | { decrement: number } };
      }) => {
        const { gte, gt } = args.where.openQuestionCount ?? {};
        const open = mocks.task.openQuestionCount;
        if (
          (gte !== undefined && open < gte) ||
          (gt !== undefined && open <= gt)
        ) {
          return Promise.resolve({ count: 0 });
        }
        const data = args.data.openQuestionCount;
        mocks.task.openQuestionCount =
          typeof data === "number" ? data : open - data.decrement;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  const withDb = Object.assign((fn: (client: unknown) => unknown) => fn(db), {
    tx: (fn: (client: unknown) => unknown) => fn(db),
  });
  return { withDb };
});

const ASK_REF = "ask-root-1";
const TASK_ID = "task-1";
const AN = {
  email: "an@c.test",
  id: "29:an",
  aadObjectId: "aad-an",
  name: "An",
};
const BINH = {
  email: "b@c.test",
  id: "29:b",
  aadObjectId: "aad-b",
  name: "Binh",
};
const T0 = new Date(2026, 0, 1, 10, 0);

function turn(ask: string[] = ["teams"], approvals = false): TurnContext {
  return {
    turnId: "turn-1",
    organizationId: "org-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    caseId: "case-1",
    projectConnectionId: null,
    channel: null,
    grants: resolveOrchestratorGrants(ask.length > 0 ? { teams: ["ask"] } : {}),
    workflowId: "workflow-1",
    workflowName: "wf",
    features: approvals ? { approvalsRequired: true } : {},
  } as unknown as TurnContext;
}

function base(): Pick<Row, "organizationId" | "conversationId"> {
  return { organizationId: "org-1", conversationId: "conversation-1" };
}

function addAsk(connectionKey = "teams"): void {
  mocks.messages.push({
    ...base(),
    id: "ask-1",
    createdAt: T0,
    origin: OrchestratorMessageOrigin.Internal,
    kind: OrchestratorMessageKind.Reply,
    externalRef: ASK_REF,
    payload: {
      teamsAsk: {
        channelId: "19:a",
        connectionKey,
        mentions: [AN, BINH],
        questions: [
          { taskId: TASK_ID, questionId: "q1" },
          { taskId: TASK_ID, questionId: "q2" },
        ],
      },
    },
  });
}

function addSummary(id: string, minute: number, questionIds: string[]): void {
  mocks.messages.push({
    ...base(),
    id,
    createdAt: new Date(2026, 0, 1, 10, minute),
    origin: OrchestratorMessageOrigin.Internal,
    kind: OrchestratorMessageKind.Reply,
    externalRef: `bot-${id}`,
    payload: {
      teamsAskReply: {
        askRef: ASK_REF,
        mentions: [AN, BINH],
        summary: questionIds.map((questionId) => ({
          taskId: TASK_ID,
          questionId,
          question: `Question ${questionId}?`,
          answer: `Answer ${questionId}`,
        })),
      },
    },
  });
}

function addConfirmation(
  ref: string,
  minute: number,
  overrides: { actorId?: string | null; askRef?: string; actor?: string } = {}
): void {
  mocks.messages.push({
    ...base(),
    id: `msg-${ref}`,
    createdAt: new Date(2026, 0, 1, 10, minute),
    origin: OrchestratorMessageOrigin.External,
    kind: OrchestratorMessageKind.Message,
    actor: overrides.actor ?? "An",
    externalRef: ref,
    payload: {
      via: OrchestratorMessageVia.Teams,
      teamsAskThread: {
        askRef: overrides.askRef ?? ASK_REF,
        actorId: "actorId" in overrides ? overrides.actorId : "aad-an",
        asked: true,
      },
    },
  });
}

function confirm(ref = "c1", context = turn()) {
  return confirmTeamsAskAnswers(context, {
    askRef: ASK_REF,
    confirmationRef: ref,
  });
}

function recorded(): Row[] {
  return mocks.messages.filter(
    (row) => row.kind === OrchestratorMessageKind.AnswersRecorded
  );
}

beforeEach(() => {
  mocks.messages = [];
  mocks.task = { openQuestionCount: 2 };
  mocks.seq = 0;
});

describe("teamsAskConfirmInputSchema", () => {
  it("requires both refs", () => {
    expect(teamsAskConfirmInputSchema.safeParse({ askRef: "a" }).success).toBe(
      false
    );
  });
});

describe("confirmTeamsAskAnswers", () => {
  it("records the answers when an asked person confirmed a later message", async () => {
    addAsk();
    addSummary("s1", 5, ["q1", "q2"]);
    addConfirmation("c1", 10);

    const outcome = await confirm();

    expect(outcome).toMatchObject({
      ok: true,
      output: { recorded: true, taskId: TASK_ID, openQuestions: 0 },
    });
    expect(mocks.task.openQuestionCount).toBe(0);
    const [row] = recorded();
    expect(row?.kind).toBe(OrchestratorMessageKind.AnswersRecorded);
    expect(row?.origin).toBe(OrchestratorMessageOrigin.Internal);
    expect(row?.turnId).toBe("turn-1");
    expect(row?.payload).toMatchObject({
      taskId: TASK_ID,
      questionIds: ["q1", "q2"],
      answers: [
        { taskId: TASK_ID, questionId: "q1", answer: "Answer q1" },
        { taskId: TASK_ID, questionId: "q2", answer: "Answer q2" },
      ],
      teamsAskConfirm: {
        askRef: ASK_REF,
        summaryMessageId: "s1",
        confirmationRef: "c1",
      },
    });
  });

  it("is allowed with approvals required", async () => {
    addAsk();
    addSummary("s1", 5, ["q1", "q2"]);
    addConfirmation("c1", 10);

    expect((await confirm("c1", turn(["teams"], true))).ok).toBe(true);
  });

  it("refuses a confirmation from someone who was not asked", async () => {
    addAsk();
    addSummary("s1", 5, ["q1"]);
    addConfirmation("c1", 10, { actorId: "aad-other", actor: "Chi" });

    const outcome = await confirm();

    expect(outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining("Chi was not asked"),
    });
    expect(outcome.ok === false && outcome.error).toContain("An, Binh");
    expect(recorded()).toHaveLength(0);
    expect(mocks.task.openQuestionCount).toBe(2);
  });

  it("refuses a confirmation older than the latest summary", async () => {
    addAsk();
    addSummary("s1", 5, ["q1"]);
    addConfirmation("c1", 10);
    addSummary("s2", 15, ["q1"]);

    expect(await confirm()).toMatchObject({
      ok: false,
      error: expect.stringContaining("came before your latest summary"),
    });
    expect(recorded()).toHaveLength(0);
  });

  it("refuses a confirmation from another ask thread", async () => {
    addAsk();
    addSummary("s1", 5, ["q1"]);
    addConfirmation("c1", 10, { askRef: "other-ask" });

    expect(await confirm()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not in the thread"),
    });
  });

  it("refuses an unknown confirmationRef", async () => {
    addAsk();
    addSummary("s1", 5, ["q1"]);

    expect(await confirm("nope")).toMatchObject({
      ok: false,
      error: expect.stringContaining("confirmationRef nope"),
    });
  });

  it("refuses when no summary was posted", async () => {
    addAsk();
    addConfirmation("c1", 10);

    expect(await confirm()).toMatchObject({
      ok: false,
      error: expect.stringContaining("teams_ask_reply answers first"),
    });
  });

  it("refuses an unknown askRef", async () => {
    addConfirmation("c1", 10);

    expect(await confirm()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a teams_ask post"),
    });
  });

  it("refuses without an ask grant", async () => {
    addAsk();

    expect(await confirm("c1", turn([]))).toMatchObject({
      ok: false,
      error: expect.stringContaining("not granted"),
    });
  });

  it("refuses when the ask's connection key is not granted", async () => {
    addAsk("revoked");
    addSummary("s1", 5, ["q1"]);
    addConfirmation("c1", 10);

    expect(await confirm()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not granted"),
    });
  });

  it("answers a second confirm of the same summary without counting again", async () => {
    addAsk();
    addSummary("s1", 5, ["q1", "q2"]);
    addConfirmation("c1", 10);
    await confirm();

    const again = await confirm();

    expect(again).toMatchObject({
      ok: true,
      output: { recorded: true, alreadyRecorded: true },
    });
    expect(recorded()).toHaveLength(1);
    expect(mocks.task.openQuestionCount).toBe(0);
  });

  it("subtracts one per confirmed summary of one question each", async () => {
    addAsk();
    addSummary("s1", 5, ["q1"]);
    addConfirmation("c1", 10);
    await confirm("c1");
    expect(mocks.task.openQuestionCount).toBe(1);

    addSummary("s2", 15, ["q2"]);
    addConfirmation("c2", 20);
    await confirm("c2");

    expect(mocks.task.openQuestionCount).toBe(0);
    expect(recorded()).toHaveLength(2);
  });
});
