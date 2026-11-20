import { describe, expect, it } from "vitest";
import {
  LoopErrorCode,
  LoopErrorCodeSchema,
  RunnerErrorSubcode,
  RunnerErrorSubcodeSchema,
} from "../src/error-codes";

describe("RunnerErrorSubcodeSchema", () => {
  it("accepts CLAUDE_UNKNOWN_SKILL", () => {
    expect(
      RunnerErrorSubcodeSchema.parse(RunnerErrorSubcode.ClaudeUnknownSkill)
    ).toBe("CLAUDE_UNKNOWN_SKILL");
  });

  it("rejects arbitrary unknown runner subcodes", () => {
    expect(RunnerErrorSubcodeSchema.safeParse("SOME_NEW_FAILURE").success).toBe(
      false
    );
  });
});

describe("LoopErrorCodeSchema", () => {
  it("accepts RESUME_SESSION_NOT_FOUND", () => {
    expect(LoopErrorCodeSchema.parse(LoopErrorCode.ResumeSessionNotFound)).toBe(
      "RESUME_SESSION_NOT_FOUND"
    );
  });
});
