import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrchestratorDbFake,
  ORG_ID,
  type OrchestratorDbFake,
} from "@/__tests__/support/orchestrator/orchestrator-db.test-fake";
import { coverTaskQuestions } from "@/lib/orchestrator/cover-questions";

const CONVERSATION_ID = "conv-1";
const TASK_ID = "task-1";

let fake: OrchestratorDbFake;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createOrchestratorDbFake();
});

let counter = 0;

function addMessage(payload: Record<string, unknown>) {
  counter += 1;
  return fake.db.orchestratorMessage.create({
    data: {
      organizationId: ORG_ID,
      conversationId: CONVERSATION_ID,
      dedupKey: `m-${counter}`,
      payload,
    },
  }) as Promise<{ id: string }>;
}

function cover(messageId: string, questionIds: string[]) {
  return coverTaskQuestions(fake.db as never, {
    organizationId: ORG_ID,
    conversationId: CONVERSATION_ID,
    messageId,
    taskId: TASK_ID,
    questionIds,
  });
}

function open(): number {
  return fake.tasks.find((task) => task.id === TASK_ID)
    ?.openQuestionCount as number;
}

describe("coverTaskQuestions", () => {
  it("subtracts every new question", async () => {
    fake.addTask(TASK_ID, 3);
    const message = await addMessage({});
    expect(await cover(message.id, ["q1", "q2"])).toBe(2);
    expect(open()).toBe(1);
  });

  it("skips a question an earlier message answered", async () => {
    fake.addTask(TASK_ID, 3);
    await addMessage({ taskId: TASK_ID, questionId: "q1" });
    const message = await addMessage({});
    expect(await cover(message.id, ["q1", "q2"])).toBe(1);
    expect(open()).toBe(2);
  });

  it("changes nothing when all are answered", async () => {
    fake.addTask(TASK_ID, 2);
    await addMessage({ taskId: TASK_ID, questionIds: ["q1", "q2"] });
    const message = await addMessage({});
    expect(await cover(message.id, ["q1", "q2"])).toBe(0);
    expect(open()).toBe(2);
  });

  it("sets the count to 0 when more are covered than open", async () => {
    fake.addTask(TASK_ID, 1);
    const message = await addMessage({});
    expect(await cover(message.id, ["q1", "q2"])).toBe(2);
    expect(open()).toBe(0);
  });
});
