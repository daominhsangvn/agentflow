import { describe, expect, it } from "vitest";

import {
  LOOP_STEP_COMMENT_ID_MAX,
  LoopStepQuestionsFileSchema,
} from "./loop-step";

describe("LoopStepQuestionsFileSchema commentId", () => {
  it("keeps commentId when present", () => {
    const parsed = LoopStepQuestionsFileSchema.parse([
      { id: "q1", question: "Which?", commentId: "10042" },
    ]);
    expect(parsed[0]?.commentId).toBe("10042");
  });

  it("accepts a question without commentId", () => {
    const parsed = LoopStepQuestionsFileSchema.parse([
      { id: "q1", question: "Which?" },
    ]);
    expect(parsed[0]?.commentId).toBeUndefined();
  });

  it("rejects an empty or too long commentId", () => {
    expect(
      LoopStepQuestionsFileSchema.safeParse([
        { id: "q1", question: "Q", commentId: "" },
      ]).success
    ).toBe(false);
    expect(
      LoopStepQuestionsFileSchema.safeParse([
        {
          id: "q1",
          question: "Q",
          commentId: "x".repeat(LOOP_STEP_COMMENT_ID_MAX + 1),
        },
      ]).success
    ).toBe(false);
  });
});
