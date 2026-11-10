import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LoopStepConfigSchema,
  LoopStepFinish,
} from "@agentflow-ai/loops-api/loop-step";
import {
  READ_ONLY_STEP_DISALLOWED_TOOLS,
  stepDisallowedToolsArgs,
  UNATTENDED_STEP_DISALLOWED_TOOLS,
} from "../src/server/operations/loop-step.js";

const STEP = {
  runId: "case-1",
  stepId: "task-1",
  name: "/ba-requirement",
  fresh: false,
  askQuestions: false,
  artifacts: [".agentflow-ai/work/orchestrator-reply.md"],
  finish: LoopStepFinish.None,
  toolkit: null,
};

test("a read-only step denies editing, committing and pushing", () => {
  const step = LoopStepConfigSchema.parse({ ...STEP, readOnly: true });
  assert.deepEqual(stepDisallowedToolsArgs(step), [
    `--disallowedTools=${UNATTENDED_STEP_DISALLOWED_TOOLS},${READ_ONLY_STEP_DISALLOWED_TOOLS}`,
  ]);
  const denied = READ_ONLY_STEP_DISALLOWED_TOOLS.split(",");
  for (const tool of [
    "Edit",
    "MultiEdit",
    "Bash(git commit:*)",
    "Bash(git push:*)",
  ]) {
    assert.ok(denied.includes(tool), tool);
  }
  // Its answer file is still written.
  assert.ok(!denied.includes("Write"));
});

test("every Claude step is denied AskUserQuestion and keeps its other tools", () => {
  assert.deepEqual(stepDisallowedToolsArgs(LoopStepConfigSchema.parse(STEP)), [
    "--disallowedTools=AskUserQuestion",
  ]);
  assert.deepEqual(stepDisallowedToolsArgs(undefined), []);
});

test("a step of another harness gets only the read-only denials", () => {
  assert.deepEqual(
    stepDisallowedToolsArgs(LoopStepConfigSchema.parse(STEP), false),
    []
  );
  assert.deepEqual(
    stepDisallowedToolsArgs(
      LoopStepConfigSchema.parse({ ...STEP, readOnly: true }),
      false
    ),
    [`--disallowedTools=${READ_ONLY_STEP_DISALLOWED_TOOLS}`]
  );
});
