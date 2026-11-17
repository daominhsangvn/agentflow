import { describe, expect, it } from "vitest";
import {
  WORKFLOW_BUILDER_MAX_MESSAGES,
  WORKFLOW_BUILDER_MAX_PROBLEMS,
  WORKFLOW_BUILDER_MAX_YAML_CHARS,
} from "./workflow-builder.ts";
import {
  proposeWorkflowInputSchema,
  proposeWorkflowOutputSchema,
  workflowBuilderChatRequestSchema,
} from "./workflow-builder-schemas.ts";

const problem = { line: 1, message: "bad", isError: true };

describe("workflow builder schemas", () => {
  it("accepts a valid proposal input", () => {
    expect(
      proposeWorkflowInputSchema.safeParse({ yaml: "name: x", summary: "s" })
        .success
    ).toBe(true);
  });

  it("rejects oversized yaml", () => {
    const yaml = "a".repeat(WORKFLOW_BUILDER_MAX_YAML_CHARS + 1);
    expect(proposeWorkflowInputSchema.safeParse({ yaml }).success).toBe(false);
  });

  it("rejects more problems than the cap", () => {
    const output = {
      valid: false,
      errorCount: 31,
      warningCount: 0,
      problems: Array.from(
        { length: WORKFLOW_BUILDER_MAX_PROBLEMS + 1 },
        () => problem
      ),
    };
    expect(proposeWorkflowOutputSchema.safeParse(output).success).toBe(false);
    expect(
      proposeWorkflowOutputSchema.safeParse({
        ...output,
        problems: output.problems.slice(0, WORKFLOW_BUILDER_MAX_PROBLEMS),
      }).success
    ).toBe(true);
  });

  it("limits chat request messages", () => {
    const base = { editorYaml: "" };
    expect(
      workflowBuilderChatRequestSchema.safeParse({
        ...base,
        messages: Array.from(
          { length: WORKFLOW_BUILDER_MAX_MESSAGES },
          () => ({})
        ),
      }).success
    ).toBe(true);
    expect(
      workflowBuilderChatRequestSchema.safeParse({
        ...base,
        messages: Array.from(
          { length: WORKFLOW_BUILDER_MAX_MESSAGES + 1 },
          () => ({})
        ),
      }).success
    ).toBe(false);
  });
});
