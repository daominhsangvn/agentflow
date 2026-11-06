import {
  OrchestratorCaseStatus,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postCaseMessage } from "@/app/orchestrator/cases/service/case-messages";

const ORG = "org-1";
const USER = "user-1";
const CASE_ID = "case-1";
const CONVERSATION = "0198f1c0-0000-7000-8000-000000000001";
const TASK = "0198f1c0-0000-7000-8000-000000000002";
const AGENT = "0198f1c0-0000-7000-8000-000000000003";

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationUpdateMany: vi.fn(),
  taskFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  taskUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
  caseUpdateMany: vi.fn(),
  loadOrchestratorWorkflows: vi.fn(),
  advanceConversation: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    user: { findFirst: mocks.userFindFirst },
    orchestratorConversation: {
      findFirst: mocks.conversationFindFirst,
      updateMany: mocks.conversationUpdateMany,
    },
    orchestratorTask: {
      findMany: mocks.taskFindMany,
      findFirst: mocks.taskFindFirst,
      updateMany: mocks.taskUpdateMany,
    },
    orchestratorMessage: { create: mocks.messageCreate },
    orchestratorCase: { updateMany: mocks.caseUpdateMany },
  };
  const withDb = (fn: (client: unknown) => unknown) => fn(db);
  withDb.tx = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb };
});
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceConversation: mocks.advanceConversation,
}));
vi.mock("@/lib/orchestrator/workflow-settings", () => ({
  loadOrchestratorWorkflows: mocks.loadOrchestratorWorkflows,
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: mocks.waitUntil }));

function workflows(debounceSeconds: number) {
  mocks.loadOrchestratorWorkflows.mockResolvedValue(
    new Map([["wf-1", { debounceSeconds }]])
  );
}

describe("postCaseMessage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.userFindFirst.mockResolvedValue({
      firstName: "Sang",
      lastName: "Dao",
      email: "s@x.io",
    });
    mocks.conversationFindFirst.mockResolvedValue({
      id: CONVERSATION,
      case: { workflowId: "wf-1" },
    });
    mocks.messageCreate.mockResolvedValue({ id: "msg-1" });
    mocks.taskFindMany.mockResolvedValue([
      {
        id: TASK,
        result: {
          reply: null,
          questions: [{ id: "q1", question: "Which API?" }],
          error: null,
        },
      },
    ]);
    workflows(30);
  });

  it("stores an External message marked via agentflow and schedules the turn", async () => {
    const result = await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Hello",
    });
    expect(result).toEqual({
      ok: true,
      value: { messageId: "msg-1", conversationId: CONVERSATION },
    });
    const data = mocks.messageCreate.mock.calls[0][0].data;
    expect(data.origin).toBe(OrchestratorMessageOrigin.External);
    expect(data.actor).toBe("Sang Dao");
    expect(data.payload.via).toBe(OrchestratorMessageVia.AgentFlow);
    expect(data.dedupKey).toBe(`agentflow:${data.externalRef}`);
    expect(
      mocks.conversationUpdateMany.mock.calls[0][0].data.nextWakeAt
    ).toBeInstanceOf(Date);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it("scopes the conversation update by organization", async () => {
    await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Hello",
    });
    expect(mocks.conversationUpdateMany.mock.calls[0][0].where).toMatchObject({
      id: CONVERSATION,
      organizationId: ORG,
    });
  });

  it("adds answers to the text and rejects an unknown question", async () => {
    await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "",
      answers: [{ taskId: TASK, questionId: "q1", answer: "REST" }],
    });
    expect(mocks.messageCreate.mock.calls[0][0].data.text).toBe(
      `Answers to the questions of task ${TASK}:\n- Which API?: REST`
    );
    const bad = await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "",
      answers: [{ taskId: TASK, questionId: "nope", answer: "x" }],
    });
    expect(bad).toEqual({ ok: false, error: Status.BadRequest });
  });

  it("returns NotFound for a conversation of another case", async () => {
    mocks.conversationFindFirst.mockResolvedValue(null);
    const result = await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Hello",
    });
    expect(result).toEqual({ ok: false, error: Status.NotFound });
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("advances at once with no debounce and reopens a closed case", async () => {
    workflows(0);
    await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Hello",
    });
    expect(mocks.advanceConversation).toHaveBeenCalledWith(CONVERSATION);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    expect(mocks.caseUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { status: OrchestratorCaseStatus.Closed },
      data: { status: OrchestratorCaseStatus.Open, closedAt: null },
    });
  });

  it("addresses an agent with a task in the case", async () => {
    mocks.taskFindFirst.mockResolvedValue({
      computeTarget: { id: AGENT, machineName: "BA-runner" },
    });
    const result = await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Ask more",
      toAgentId: AGENT,
    });
    expect(result.ok).toBe(true);
    expect(mocks.taskFindFirst.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      caseId: CASE_ID,
      computeTargetId: AGENT,
    });
    expect(mocks.messageCreate.mock.calls[0][0].data.payload.toAgent).toEqual({
      computeTargetId: AGENT,
      name: "BA-runner",
    });
  });

  it("refuses an agent without a task in the case and creates no message", async () => {
    mocks.taskFindFirst.mockResolvedValue(null);
    const result = await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Ask more",
      toAgentId: AGENT,
    });
    expect(result).toEqual({ ok: false, error: Status.Conflict });
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("clears the open questions of the answered tasks only", async () => {
    await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "",
      answers: [{ taskId: TASK, questionId: "q1", answer: "REST" }],
    });
    expect(mocks.taskUpdateMany).toHaveBeenCalledTimes(1);
    expect(mocks.taskUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: [TASK] }, caseId: CASE_ID, organizationId: ORG },
      data: { openQuestionCount: 0 },
    });
  });

  it("clears nothing without answers", async () => {
    await postCaseMessage(ORG, USER, CASE_ID, {
      conversationId: CONVERSATION,
      text: "Hello",
    });
    expect(mocks.taskUpdateMany).not.toHaveBeenCalled();
  });
});
