import type {
  OrchestratorCaseDetail,
  OrchestratorCaseMessage,
  OrchestratorCaseTask,
} from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";

import { AgentTimelineEntryKind, buildAgentTimeline } from "../agent-timeline";

function task(partial: Partial<OrchestratorCaseTask>): OrchestratorCaseTask {
  return {
    id: "t",
    conversationId: "conv-1",
    computeTargetId: "a",
    openQuestionCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    finishedAt: null,
    ...partial,
  } as OrchestratorCaseTask;
}

function message(
  partial: Partial<OrchestratorCaseMessage>
): OrchestratorCaseMessage {
  return {
    id: "m",
    conversationId: "conv-1",
    createdAt: "2026-01-01T00:00:00Z",
    ...partial,
  } as OrchestratorCaseMessage;
}

describe("buildAgentTimeline", () => {
  const detail = {
    tasks: [
      task({
        id: "t1",
        createdAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:05:00Z",
        openQuestionCount: 1,
      }),
      task({
        id: "t2",
        conversationId: "conv-2",
        createdAt: "2026-01-02T00:00:00Z",
      }),
      task({
        id: "t3",
        computeTargetId: "b",
        createdAt: "2026-01-03T00:00:00Z",
      }),
    ],
    conversations: [
      {
        messages: [
          message({
            id: "m1",
            createdAt: "2026-01-01T00:10:00Z",
            toAgentId: "a",
          }),
          message({
            id: "m2",
            createdAt: "2026-01-01T00:20:00Z",
            answeredTaskIds: ["t1"],
          }),
          message({ id: "m3", toAgentId: "b" }),
          message({ id: "m4", answeredTaskIds: ["t3"] }),
        ],
      },
    ],
  } as unknown as OrchestratorCaseDetail;

  it("orders every kind by time for the agent", () => {
    const result = buildAgentTimeline(detail, "a");
    expect(result.entries.map((e) => [e.kind, e.id])).toEqual([
      [AgentTimelineEntryKind.ToAgent, "t1:to"],
      [AgentTimelineEntryKind.FromAgent, "t1:from"],
      [AgentTimelineEntryKind.AskedByPerson, "m1"],
      [AgentTimelineEntryKind.Answer, "m2"],
      [AgentTimelineEntryKind.ToAgent, "t2:to"],
    ]);
  });

  it("exposes open question tasks and the newest task's conversation", () => {
    const result = buildAgentTimeline(detail, "a");
    expect(result.openQuestionTasks.map((t) => t.id)).toEqual(["t1"]);
    expect(result.conversationId).toBe("conv-2");
  });

  it("returns an empty timeline for an agent without tasks", () => {
    expect(buildAgentTimeline(detail, "z")).toMatchObject({
      entries: [],
      conversationId: null,
    });
  });
});
