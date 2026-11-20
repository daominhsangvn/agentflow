import assert from "node:assert/strict";
import { test } from "node:test";
import { LoopCommand } from "@agentflow-ai/loops-api/commands";
import type { LoopStepConfig } from "@agentflow-ai/loops-api/loop-step";
import {
  isStepResumeSessionMiss,
  type ResumeMissInput,
} from "../src/server/operations/loop-step-resume-miss.js";

const MISSING = "No conversation found with session ID: x";

function stepConfig(reportResumeMiss: boolean): LoopStepConfig {
  return {
    runId: "run-1",
    stepId: "step-1",
    name: "Step",
    fresh: true,
    askQuestions: false,
    artifacts: [],
    finish: "none",
    toolkit: null,
    ...(reportResumeMiss ? { reportResumeMiss: true } : {}),
  } as LoopStepConfig;
}

function input(overrides: Partial<ResumeMissInput> = {}): ResumeMissInput {
  return {
    command: LoopCommand.Step,
    step: stepConfig(true),
    parentSessionId: "session-1",
    texts: [undefined, MISSING],
    producedAssistantMessage: false,
    ...overrides,
  };
}

test("a flagged step with a parent session and the missing-session text is a miss", () => {
  assert.equal(isStepResumeSessionMiss(input()), true);
});

test("a case task loop without the flag keeps its codes", () => {
  assert.equal(
    isStepResumeSessionMiss(input({ step: stepConfig(false) })),
    false
  );
  assert.equal(isStepResumeSessionMiss(input({ step: undefined })), false);
});

test("no miss without a parent session", () => {
  assert.equal(
    isStepResumeSessionMiss(input({ parentSessionId: null })),
    false
  );
  assert.equal(isStepResumeSessionMiss(input({ parentSessionId: "" })), false);
});

test("no miss when the agent produced a message", () => {
  assert.equal(
    isStepResumeSessionMiss(input({ producedAssistantMessage: true })),
    false
  );
});

test("no miss for another command", () => {
  assert.equal(
    isStepResumeSessionMiss(input({ command: LoopCommand.Execute })),
    false
  );
});

test("no miss for unrelated failure text", () => {
  assert.equal(
    isStepResumeSessionMiss(
      input({ texts: ["fatal: could not create branch af/step-1"] })
    ),
    false
  );
});
