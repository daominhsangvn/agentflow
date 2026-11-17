import { describe, expect, it } from "vitest";
import {
  GLOB_TOOL_USE_LINE,
  INIT_LINE,
  MESSAGE_START_LINE,
  NOISE_LINE,
  PERMISSION_DENIED_LINE,
  READ_GUIDE_TOOL_USE_LINE,
  resultLine,
  STATUS_LINE,
  SUBAGENT_DELTA_LINE,
  textDeltaLine,
  toolResultLine,
  UNKNOWN_TYPE_LINE,
} from "@/__tests__/support/platform-agent/stream-json-fixtures";
import {
  AgentRunOutcome,
  parseStreamJsonLine,
  type ResultEvent,
  StreamJsonEventKind,
  toAgentRunOutcome,
} from "../stream-json";

describe("parseStreamJsonLine", () => {
  it("reads text deltas", () => {
    expect(parseStreamJsonLine(textDeltaLine("hi"))).toEqual([
      { kind: StreamJsonEventKind.TextDelta, text: "hi" },
    ]);
  });

  it("ignores subagent text deltas", () => {
    expect(parseStreamJsonLine(SUBAGENT_DELTA_LINE)).toEqual([]);
  });

  it("reads tool_use items", () => {
    const events = parseStreamJsonLine(READ_GUIDE_TOOL_USE_LINE);
    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      kind: StreamJsonEventKind.ToolUse,
      id: "toolu_1",
      name: "Read",
    });
    expect(parseStreamJsonLine(GLOB_TOOL_USE_LINE)?.[0]).toMatchObject({
      name: "Glob",
    });
  });

  it("reads tool results with and without is_error", () => {
    expect(parseStreamJsonLine(toolResultLine("t1"))).toEqual([
      { kind: StreamJsonEventKind.ToolResult, toolUseId: "t1", isError: false },
    ]);
    expect(parseStreamJsonLine(toolResultLine("t2", true))).toEqual([
      { kind: StreamJsonEventKind.ToolResult, toolUseId: "t2", isError: true },
    ]);
  });

  it("reads permission denials", () => {
    expect(parseStreamJsonLine(PERMISSION_DENIED_LINE)).toEqual([
      { kind: StreamJsonEventKind.PermissionDenied },
    ]);
  });

  it("reads results", () => {
    expect(
      parseStreamJsonLine(
        resultLine({ subtype: "error_max_turns", isError: true, numTurns: 12 })
      )
    ).toEqual([
      {
        kind: StreamJsonEventKind.Result,
        subtype: "error_max_turns",
        isError: true,
        result: "",
        numTurns: 12,
      },
    ]);
  });

  it("returns an empty list for lines that carry nothing", () => {
    expect(parseStreamJsonLine(INIT_LINE)).toEqual([]);
    expect(parseStreamJsonLine(STATUS_LINE)).toEqual([]);
    expect(parseStreamJsonLine(MESSAGE_START_LINE)).toEqual([]);
    expect(parseStreamJsonLine(UNKNOWN_TYPE_LINE)).toEqual([]);
  });

  it("returns null for noise and malformed known types", () => {
    expect(parseStreamJsonLine(NOISE_LINE)).toBeNull();
    expect(parseStreamJsonLine("[1]")).toBeNull();
    expect(parseStreamJsonLine('{"type":"result"}')).toBeNull();
    expect(parseStreamJsonLine('{"type":"assistant","message":{}}')).toBeNull();
  });
});

describe("toAgentRunOutcome", () => {
  const base: ResultEvent = {
    kind: StreamJsonEventKind.Result,
    subtype: "success",
    isError: false,
  };

  it("maps results", () => {
    expect(toAgentRunOutcome(null)).toBe(AgentRunOutcome.NoResult);
    expect(toAgentRunOutcome(base)).toBe(AgentRunOutcome.Success);
    expect(
      toAgentRunOutcome({ ...base, subtype: "error_max_turns", isError: true })
    ).toBe(AgentRunOutcome.MaxTurns);
    expect(
      toAgentRunOutcome({
        ...base,
        subtype: "error_during_execution",
        isError: true,
      })
    ).toBe(AgentRunOutcome.CliError);
  });
});
