import { describe, expect, it } from "vitest";
import {
  askedOnItem,
  askedQuestionNote,
  askedQuestionsText,
  readAnsweredQuestion,
} from "../asked-questions";
import { readTaskResult } from "../task-result";

describe("asked-questions", () => {
  it("keeps only questions with a commentId", () => {
    const asked = askedOnItem([
      { id: "q1", question: "a", commentId: "10" },
      { id: "q2", question: "b" },
    ]);
    expect(asked.map((q) => q.id)).toEqual(["q1"]);
  });

  it("lists the comments in the text", () => {
    const text = askedQuestionsText({
      taskId: "t1",
      command: "plan",
      runnerName: null,
      itemKey: "PRO-1",
      questions: [{ id: "q1", question: "Which?", commentId: "10" }],
    });
    expect(text).toContain("a removed runner");
    expect(text).toContain("PRO-1");
    expect(text).toContain('task="t1"');
    expect(text).toContain("- q1 (comment 10): Which?");
  });

  it("reads the answered question from a payload", () => {
    expect(readAnsweredQuestion({ taskId: "t1", questionId: "q2" })).toEqual({
      taskId: "t1",
      questionId: "q2",
      questionIds: null,
    });
    expect(readAnsweredQuestion({ taskId: "t1" })).toEqual({
      taskId: "t1",
      questionId: null,
      questionIds: null,
    });
    expect(readAnsweredQuestion({ questionId: "q2" })).toBeNull();
    expect(readAnsweredQuestion(null)).toBeNull();
  });

  it("notes only asked questions", () => {
    expect(askedQuestionNote({ id: "q", question: "x" })).toBe("");
    expect(
      askedQuestionNote({ id: "q", question: "x", commentId: "10" })
    ).toContain("comment 10");
  });

  it("keeps commentId in a task result", () => {
    const result = readTaskResult({
      reply: null,
      error: null,
      questions: [{ id: "q1", question: "x", commentId: "10" }],
    });
    expect(result?.questions[0]?.commentId).toBe("10");
  });
});
