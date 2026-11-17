import { z } from "zod";

/** Claude Code tool names a consumer may allow. */
export const ClaudeCodeTool = {
  Read: "Read",
  Grep: "Grep",
  Glob: "Glob",
} as const;
export type ClaudeCodeTool =
  (typeof ClaudeCodeTool)[keyof typeof ClaudeCodeTool];

export const StreamJsonEventKind = {
  TextDelta: "text_delta",
  ToolUse: "tool_use",
  ToolResult: "tool_result",
  PermissionDenied: "permission_denied",
  Result: "result",
} as const;
export type StreamJsonEventKind =
  (typeof StreamJsonEventKind)[keyof typeof StreamJsonEventKind];

export type ResultEvent = {
  kind: typeof StreamJsonEventKind.Result;
  subtype: string;
  isError: boolean;
  result?: string;
  numTurns?: number;
};

export type StreamJsonEvent =
  | { kind: typeof StreamJsonEventKind.TextDelta; text: string }
  | {
      kind: typeof StreamJsonEventKind.ToolUse;
      id: string;
      name: string;
      input: unknown;
    }
  | {
      kind: typeof StreamJsonEventKind.ToolResult;
      toolUseId: string;
      isError: boolean;
    }
  | { kind: typeof StreamJsonEventKind.PermissionDenied }
  | ResultEvent;

export const AgentRunOutcome = {
  Success: "success",
  MaxTurns: "max_turns",
  CliError: "cli_error",
  NoResult: "no_result",
} as const;
export type AgentRunOutcome =
  (typeof AgentRunOutcome)[keyof typeof AgentRunOutcome];

const LineType = {
  System: "system",
  StreamEvent: "stream_event",
  Assistant: "assistant",
  User: "user",
  Result: "result",
} as const;

const SUBTYPE_PERMISSION_DENIED = "permission_denied";
const SUBTYPE_ERROR_MAX_TURNS = "error_max_turns";
const CONTENT_TOOL_USE = "tool_use";
const CONTENT_TOOL_RESULT = "tool_result";
const EVENT_CONTENT_BLOCK_DELTA = "content_block_delta";
const DELTA_TEXT = "text_delta";

const systemSchema = z.looseObject({ subtype: z.string().optional() });

const streamEventSchema = z.looseObject({
  parent_tool_use_id: z.string().nullish(),
  event: z.looseObject({
    type: z.string(),
    delta: z
      .looseObject({
        type: z.string().optional(),
        text: z.string().optional(),
      })
      .optional(),
  }),
});

const assistantSchema = z.looseObject({
  message: z.looseObject({
    content: z.array(
      z.looseObject({
        type: z.string(),
        id: z.string().optional(),
        name: z.string().optional(),
        input: z.unknown().optional(),
      })
    ),
  }),
});

const userSchema = z.looseObject({
  message: z.looseObject({
    content: z.array(
      z.looseObject({
        type: z.string(),
        tool_use_id: z.string().optional(),
        is_error: z.boolean().optional(),
      })
    ),
  }),
});

const resultSchema = z.looseObject({
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  num_turns: z.number().optional(),
});

const envelopeSchema = z.looseObject({ type: z.string() });

/**
 * Parses one stdout line of `claude -p --output-format stream-json`.
 * `null`: not JSON, or a known type with an unexpected shape (the caller counts it as ignored).
 * `[]`: a valid line that carries nothing we use.
 */
export function parseStreamJsonLine(raw: string): StreamJsonEvent[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // observability: the caller counts it as an ignored line
    return null;
  }
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return null;
  }
  switch (envelope.data.type) {
    case LineType.System:
      return parseWith(systemSchema, json, fromSystem);
    case LineType.StreamEvent:
      return parseWith(streamEventSchema, json, fromStreamEvent);
    case LineType.Assistant:
      return parseWith(assistantSchema, json, fromAssistant);
    case LineType.User:
      return parseWith(userSchema, json, fromUser);
    case LineType.Result:
      return parseWith(resultSchema, json, fromResult);
    default:
      return [];
  }
}

export function toAgentRunOutcome(result: ResultEvent | null): AgentRunOutcome {
  if (result === null) {
    return AgentRunOutcome.NoResult;
  }
  if (result.subtype === SUBTYPE_ERROR_MAX_TURNS) {
    return AgentRunOutcome.MaxTurns;
  }
  if (result.isError) {
    return AgentRunOutcome.CliError;
  }
  return AgentRunOutcome.Success;
}

function parseWith<S extends z.ZodType>(
  schema: S,
  json: unknown,
  convert: (data: z.infer<S>) => StreamJsonEvent[]
): StreamJsonEvent[] | null {
  const parsed = schema.safeParse(json);
  return parsed.success ? convert(parsed.data) : null;
}

function fromSystem(data: z.infer<typeof systemSchema>): StreamJsonEvent[] {
  return data.subtype === SUBTYPE_PERMISSION_DENIED
    ? [{ kind: StreamJsonEventKind.PermissionDenied }]
    : [];
}

function fromStreamEvent(
  data: z.infer<typeof streamEventSchema>
): StreamJsonEvent[] {
  const { event } = data;
  const isSubagent =
    data.parent_tool_use_id !== null && data.parent_tool_use_id !== undefined;
  if (
    isSubagent ||
    event.type !== EVENT_CONTENT_BLOCK_DELTA ||
    event.delta?.type !== DELTA_TEXT ||
    event.delta.text === undefined
  ) {
    return [];
  }
  return [{ kind: StreamJsonEventKind.TextDelta, text: event.delta.text }];
}

function fromAssistant(
  data: z.infer<typeof assistantSchema>
): StreamJsonEvent[] {
  const events: StreamJsonEvent[] = [];
  for (const item of data.message.content) {
    if (item.type === CONTENT_TOOL_USE) {
      events.push({
        kind: StreamJsonEventKind.ToolUse,
        id: item.id ?? "",
        name: item.name ?? "",
        input: item.input,
      });
    }
  }
  return events;
}

function fromUser(data: z.infer<typeof userSchema>): StreamJsonEvent[] {
  const events: StreamJsonEvent[] = [];
  for (const item of data.message.content) {
    if (item.type === CONTENT_TOOL_RESULT) {
      events.push({
        kind: StreamJsonEventKind.ToolResult,
        toolUseId: item.tool_use_id ?? "",
        isError: item.is_error === true,
      });
    }
  }
  return events;
}

function fromResult(data: z.infer<typeof resultSchema>): StreamJsonEvent[] {
  return [
    {
      kind: StreamJsonEventKind.Result,
      subtype: data.subtype,
      isError: data.is_error,
      result: data.result,
      numTurns: data.num_turns,
    },
  ];
}
