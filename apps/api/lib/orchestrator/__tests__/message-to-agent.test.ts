import { describe, expect, it } from "vitest";
import { readMessageToAgent } from "@/lib/orchestrator/message-to-agent";

describe("readMessageToAgent", () => {
  it("reads the addressed agent", () => {
    expect(
      readMessageToAgent({
        via: "agentflow",
        toAgent: { computeTargetId: "ct-1", name: "BA" },
      })
    ).toEqual({ computeTargetId: "ct-1", name: "BA" });
  });

  it("reads the optional open-questions task", () => {
    expect(
      readMessageToAgent({
        toAgent: {
          computeTargetId: "ct-1",
          name: "BA",
          openQuestionTaskId: "t9",
        },
      })
    ).toEqual({
      computeTargetId: "ct-1",
      name: "BA",
      openQuestionTaskId: "t9",
    });
  });

  it("is null without an addressed agent or with a malformed one", () => {
    expect(readMessageToAgent({ via: "agentflow" })).toBeNull();
    expect(readMessageToAgent({ toAgent: { name: "BA" } })).toBeNull();
    expect(readMessageToAgent(null)).toBeNull();
  });
});
