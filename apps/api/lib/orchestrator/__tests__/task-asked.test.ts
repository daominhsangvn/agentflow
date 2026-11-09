import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { OrchestratorMessageKind } from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAskedQuestions } from "@/lib/orchestrator/task-asked";

const state = vi.hoisted(() => ({
  task: null as unknown,
  createMany: vi.fn(),
  createMessage: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTask: { findUnique: () => Promise.resolve(state.task) },
    orchestratorAnchor: { createMany: state.createMany },
    orchestratorMessage: { create: state.createMessage },
  };
  return { withDb: (fn: (d: typeof db) => unknown) => fn(db) };
});

const channel = {
  item: {
    provider: IntegrationProviderKey.Jira,
    externalId: "1",
    key: "PRO-1",
    url: null,
    title: null,
    container: null,
  },
  parentId: null,
  extras: null,
};

function taskWith(
  channelValue: unknown,
  connectionId: string | null = "conn-1"
) {
  return {
    organizationId: "org",
    conversationId: "conv",
    command: "/plan",
    args: "",
    computeTarget: { machineName: "runner-1" },
    conversation: {
      channel: channelValue,
      projectConnection: connectionId ? { connectionId } : null,
    },
  };
}

const QUESTIONS = [
  { id: "q1", question: "A?", commentId: "10" },
  { id: "q2", question: "B?", commentId: "11" },
];

beforeEach(() => {
  state.createMany.mockReset().mockResolvedValue({ count: 2 });
  state.createMessage.mockReset().mockResolvedValue({});
  state.task = taskWith(channel);
});

describe("recordAskedQuestions", () => {
  it("writes nothing without a commentId", async () => {
    await recordAskedQuestions("t1", [{ id: "q1", question: "A?" }]);
    expect(state.createMany).not.toHaveBeenCalled();
    expect(state.createMessage).not.toHaveBeenCalled();
  });

  it("anchors each comment and records one task_asked message", async () => {
    await recordAskedQuestions("t1", QUESTIONS);
    expect(state.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          provider: IntegrationProviderKey.Jira,
          connectionId: "conn-1",
          externalRef: "10",
          taskId: "t1",
          questionId: "q1",
        }),
        expect.objectContaining({
          externalRef: "11",
          taskId: "t1",
          questionId: "q2",
        }),
      ],
      skipDuplicates: true,
    });
    const data = state.createMessage.mock.calls[0][0].data;
    expect(data.kind).toBe(OrchestratorMessageKind.TaskAsked);
    expect(data.text).toContain("comment 10");
    expect(data.text).toContain("comment 11");
  });

  it("records the message but no anchors without a channel", async () => {
    state.task = taskWith(null);
    await recordAskedQuestions("t1", QUESTIONS);
    expect(state.createMany).not.toHaveBeenCalled();
    expect(state.createMessage).toHaveBeenCalledTimes(1);
  });

  it("records the message but no anchors without a project connection", async () => {
    state.task = taskWith(channel, null);
    await recordAskedQuestions("t1", QUESTIONS);
    expect(state.createMany).not.toHaveBeenCalled();
    expect(state.createMessage).toHaveBeenCalledTimes(1);
  });

  it("resolves when the message already exists", async () => {
    state.createMessage.mockRejectedValue({ code: "P2002" });
    await expect(
      recordAskedQuestions("t1", QUESTIONS)
    ).resolves.toBeUndefined();
  });

  it("is idempotent on anchors when called twice", async () => {
    await recordAskedQuestions("t1", QUESTIONS);
    await recordAskedQuestions("t1", QUESTIONS);
    for (const call of state.createMany.mock.calls) {
      expect(call[0].skipDuplicates).toBe(true);
    }
    expect(state.createMany).toHaveBeenCalledTimes(2);
  });
});
