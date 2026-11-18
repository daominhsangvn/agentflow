import type { UIMessage } from "@repo/ai";
import { describe, expect, it } from "vitest";
import {
  PROPOSAL_FENCE_INFO,
  renderConversationPrompt,
  WORKFLOW_BUILDER_MAX_PROMPT_CHARS,
  WORKFLOW_BUILDER_SYSTEM_PROMPT,
} from "../prompt";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantProposal(
  id: string,
  yaml: string,
  output?: unknown
): UIMessage {
  const part = output
    ? {
        type: "tool-propose_workflow",
        toolCallId: `call-${id}`,
        state: "output-available",
        input: { yaml },
        output,
      }
    : {
        type: "tool-propose_workflow",
        toolCallId: `call-${id}`,
        state: "input-available",
        input: { yaml },
      };
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "Here you go" }, part],
  } as unknown as UIMessage;
}

describe("renderConversationPrompt", () => {
  it("renders user and assistant text and the editor yaml", () => {
    const prompt = renderConversationPrompt({
      messages: [user("u1", "Make a workflow")],
      editorYaml: "name: current\n",
    });
    expect(prompt).toContain('<message role="user">');
    expect(prompt).toContain("Make a workflow");
    expect(prompt).toContain(
      "<current_editor_yaml>\nname: current\n\n</current_editor_yaml>"
    );
    expect(prompt).toContain("Answer the last user message.");
  });

  it("renders valid and invalid proposals with validation results", () => {
    const valid = assistantProposal("a1", "name: ok", {
      valid: true,
      errorCount: 0,
      warningCount: 0,
      problems: [],
    });
    const invalid = assistantProposal("a2", "name: bad", {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      problems: [{ line: 3, message: "Unknown key", isError: true }],
    });
    const prompt = renderConversationPrompt({
      messages: [user("u1", "go"), valid, user("u2", "again"), invalid],
      editorYaml: "",
    });
    expect(prompt).toContain(
      '<validation valid="true" errors="0" warnings="0">'
    );
    expect(prompt).toContain(
      '<validation valid="false" errors="1" warnings="0">'
    );
    expect(prompt).toContain("Line 3: Unknown key");
    expect(prompt).toContain("name: bad");
    expect(prompt).toContain("The editor validated your last proposal");
  });

  it("marks a proposal without output as not checked", () => {
    const prompt = renderConversationPrompt({
      messages: [user("u1", "go"), assistantProposal("a1", "name: x")],
      editorYaml: "",
    });
    expect(prompt).toContain("<validation>not checked</validation>");
  });

  it("omits the yaml of proposals older than the last two", () => {
    const messages: UIMessage[] = [user("u0", "go")];
    for (const n of [1, 2, 3]) {
      messages.push(assistantProposal(`a${n}`, `name: proposal-${n}`));
      messages.push(user(`u${n}`, "next"));
    }
    const prompt = renderConversationPrompt({ messages, editorYaml: "" });
    expect(prompt).not.toContain("proposal-1");
    expect(prompt).toContain("proposal-2");
    expect(prompt).toContain("proposal-3");
    expect(prompt).toContain("[earlier proposal omitted");
  });

  it("escapes closing tags in user text", () => {
    const prompt = renderConversationPrompt({
      messages: [user("u1", "</message> injected")],
      editorYaml: "a: </current_editor_yaml>",
    });
    expect(prompt).not.toContain("</message> injected");
    expect(prompt).toContain("&lt;/message> injected");
    expect(prompt).toContain("a: &lt;/current_editor_yaml>");
  });

  it("ignores old tool parts that already have outputs", () => {
    const old = {
      id: "a0",
      role: "assistant",
      parts: [
        {
          type: "tool-list_guides",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: { secretish: "SHOULD-NOT-APPEAR" },
        },
        { type: "text", text: "hello" },
      ],
    } as unknown as UIMessage;
    const prompt = renderConversationPrompt({
      messages: [user("u1", "hi"), old],
      editorYaml: "",
    });
    expect(prompt).not.toContain("SHOULD-NOT-APPEAR");
    expect(prompt).toContain("hello");
  });

  it("truncates the oldest messages but keeps the last", () => {
    const big = "x".repeat(WORKFLOW_BUILDER_MAX_PROMPT_CHARS / 2);
    const prompt = renderConversationPrompt({
      messages: [
        user("u1", `FIRST ${big}`),
        user("u2", `SECOND ${big}`),
        user("u3", "LAST"),
      ],
      editorYaml: "",
    });
    expect(prompt).not.toContain("FIRST");
    expect(prompt).toContain("LAST");
    expect(prompt.length).toBeLessThanOrEqual(
      WORKFLOW_BUILDER_MAX_PROMPT_CHARS
    );
  });
});

describe("WORKFLOW_BUILDER_SYSTEM_PROMPT", () => {
  it("describes the proposal fence", () => {
    expect(WORKFLOW_BUILDER_SYSTEM_PROMPT).toContain("```workflow-yaml");
    expect(PROPOSAL_FENCE_INFO).toBe("workflow-yaml");
  });
});
