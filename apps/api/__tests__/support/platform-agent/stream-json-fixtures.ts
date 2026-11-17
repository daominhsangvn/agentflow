/** Placeholder for the per-run work dir inside fixture lines. */
export const WORK_DIR_PLACEHOLDER = "{{WORK_DIR}}";

/** Replaces the placeholder with a (JSON-escaped) work dir path in every line. */
export function substituteWorkDir(
  lines: readonly string[],
  workDir: string
): string[] {
  const escaped = JSON.stringify(workDir).slice(1, -1);
  return lines.map((line) => line.replaceAll(WORK_DIR_PLACEHOLDER, escaped));
}

function line(value: unknown): string {
  return JSON.stringify(value);
}

export function textDeltaLine(text: string, parentToolUseId?: string): string {
  return line({
    type: "stream_event",
    parent_tool_use_id: parentToolUseId ?? null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
  });
}

export function toolUseLine(
  id: string,
  name: string,
  input: Record<string, unknown>
): string {
  return line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

export function toolResultLine(id: string, isError = false): string {
  return line({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: isError ? "File does not exist." : "ok",
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
  });
}

export function resultLine(input: {
  subtype?: string;
  isError?: boolean;
  result?: string;
  numTurns?: number;
}): string {
  return line({
    type: "result",
    subtype: input.subtype ?? "success",
    is_error: input.isError ?? false,
    result: input.result ?? "",
    num_turns: input.numTurns ?? 1,
    session_id: "s-1",
  });
}

export const INIT_LINE = line({
  type: "system",
  subtype: "init",
  cwd: WORK_DIR_PLACEHOLDER,
  tools: ["Glob", "Grep", "Read"],
  mcp_servers: [],
  permissionMode: "default",
  claude_code_version: "2.1.322",
});
export const STATUS_LINE = line({ type: "system", subtype: "status" });
export const PERMISSION_DENIED_LINE = line({
  type: "system",
  subtype: "permission_denied",
  tool_name: "Read",
});
export const MESSAGE_START_LINE = line({
  type: "stream_event",
  parent_tool_use_id: null,
  event: { type: "message_start" },
});
export const NOISE_LINE = "this is not json";
export const UNKNOWN_TYPE_LINE = line({ type: "rate_limit_event", info: {} });
export const SUBAGENT_DELTA_LINE = textDeltaLine("subagent text", "toolu_sub");

export const READ_GUIDE_TOOL_USE_LINE = toolUseLine("toolu_1", "Read", {
  file_path: `${WORK_DIR_PLACEHOLDER}/guides/yaml-reference.md`,
});
export const READ_CATALOG_TOOL_USE_LINE = toolUseLine("toolu_2", "Read", {
  file_path: `${WORK_DIR_PLACEHOLDER}/catalog.json`,
});
export const GREP_TOOL_USE_LINE = toolUseLine("toolu_3", "Grep", {
  pattern: "trigger",
  path: WORK_DIR_PLACEHOLDER,
});
export const GLOB_TOOL_USE_LINE = toolUseLine("toolu_4", "Glob", {
  pattern: "guides/*.md",
});

/** A full successful run whose answer ends with a fenced proposal split across deltas. */
export const SUCCESS_RUN_LINES: readonly string[] = [
  INIT_LINE,
  STATUS_LINE,
  MESSAGE_START_LINE,
  READ_GUIDE_TOOL_USE_LINE,
  toolResultLine("toolu_1"),
  textDeltaLine("Here is the workflow.\n``"),
  textDeltaLine("`workflow-"),
  textDeltaLine("yaml\nname: Demo\n"),
  textDeltaLine("steps: []\n```"),
  resultLine({ result: "Here is the workflow." }),
];
