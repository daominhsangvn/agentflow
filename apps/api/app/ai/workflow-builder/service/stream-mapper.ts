import type { UIMessageChunk } from "@repo/ai";
import { WorkflowBuilderToolName } from "@repo/api/src/types/workflow-builder";
import { proposeWorkflowInputSchema } from "@repo/api/src/types/workflow-builder-schemas";
import { z } from "zod";
import {
  AgentRunOutcome,
  ClaudeCodeTool,
  parseStreamJsonLine,
  type ResultEvent,
  type StreamJsonEvent,
  StreamJsonEventKind,
  toAgentRunOutcome,
} from "@/lib/platform-agent/stream-json";
import { PROPOSAL_FENCE_INFO } from "./prompt";

export type UiChunkSink = (chunk: UIMessageChunk) => void;

export type ProposalFenceResult = {
  text: string;
  proposals: string[];
  unclosed: boolean;
};

export type StreamMapperEnd = {
  outcome: AgentRunOutcome;
  proposal: boolean;
  permissionDenials: number;
  ignoredLines: number;
  resultSubtype?: string;
};

export const MapperNotice = {
  ProposalTooLong: "The proposal was too long for the editor.",
  ProposalEmpty: "The proposal was empty.",
  ToolInterrupted: "The step did not finish",
  ProposalCutOff:
    "The proposal was cut off. Ask again to get the complete YAML.",
  MaxTurns:
    "The assistant stopped after its step limit. Send a message to continue.",
  FileUnavailable: "File not available",
} as const;

const FENCE_MARKER_PREFIX = "```";
const CLOSING_TRAILING_RE = /[ \t\r]+$/;
const TRAILING_SLASHES_RE = /\/+$/;
const CATALOG_FILE = "catalog.json";
const NOTICE_SEPARATOR = "\n\n";

const FenceMode = {
  Text: "text",
  OpenerLine: "opener_line",
  Fence: "fence",
} as const;
type FenceMode = (typeof FenceMode)[keyof typeof FenceMode];

/**
 * Streaming filter that removes the proposal fence from the visible text. `push` returns the text
 * that may be shown now; fence contents are collected in `proposals`.
 */
export function createProposalFenceFilter(info: string = PROPOSAL_FENCE_INFO) {
  const marker = `${FENCE_MARKER_PREFIX}${info}`;
  let mode: FenceMode = FenceMode.Text;
  let atLineStart = true;
  let held = "";
  let fenceLine = "";
  let body: string[] = [];
  const proposals: string[] = [];

  function closeBlock(): void {
    proposals.push(body.map((bodyLine) => `${bodyLine}\n`).join(""));
    body = [];
    fenceLine = "";
    mode = FenceMode.Text;
    atLineStart = true;
  }

  function completeFenceLine(): void {
    if (fenceLine.replace(CLOSING_TRAILING_RE, "") === FENCE_MARKER_PREFIX) {
      closeBlock();
      return;
    }
    body.push(fenceLine.endsWith("\r") ? fenceLine.slice(0, -1) : fenceLine);
    fenceLine = "";
  }

  function textStep(input: string): { out: string; rest: string } {
    if (!atLineStart) {
      const newline = input.indexOf("\n");
      if (newline < 0) {
        return { out: input, rest: "" };
      }
      atLineStart = true;
      return {
        out: input.slice(0, newline + 1),
        rest: input.slice(newline + 1),
      };
    }
    if (input.startsWith(marker)) {
      mode = FenceMode.OpenerLine;
      return { out: "", rest: input.slice(marker.length) };
    }
    if (marker.startsWith(input)) {
      held = input;
      return { out: "", rest: "" };
    }
    atLineStart = false;
    return { out: "", rest: input };
  }

  function openerStep(input: string): string {
    const newline = input.indexOf("\n");
    if (newline < 0) {
      return "";
    }
    mode = FenceMode.Fence;
    return input.slice(newline + 1);
  }

  function fenceStep(input: string): string {
    const newline = input.indexOf("\n");
    if (newline < 0) {
      fenceLine += input;
      return "";
    }
    fenceLine += input.slice(0, newline);
    completeFenceLine();
    return input.slice(newline + 1);
  }

  return {
    push(delta: string): string {
      let input = held + delta;
      held = "";
      let out = "";
      while (input.length > 0) {
        if (mode === FenceMode.Text) {
          const step = textStep(input);
          out += step.out;
          input = step.rest;
          if (held !== "") {
            break;
          }
        } else if (mode === FenceMode.OpenerLine) {
          input = openerStep(input);
        } else {
          input = fenceStep(input);
        }
      }
      return out;
    },
    finish(): ProposalFenceResult {
      let text = "";
      let unclosed = false;
      if (mode === FenceMode.Text) {
        text = held;
        held = "";
      } else if (mode === FenceMode.OpenerLine) {
        unclosed = true;
      } else {
        completeFenceLine();
        unclosed = mode === FenceMode.Fence;
      }
      return { text, proposals: [...proposals], unclosed };
    },
  };
}

/** Maps `claude -p` stream-json lines to AI SDK UI message chunks for one response step. */
export function createStreamJsonMapper(options: {
  write: UiChunkSink;
  generateId: () => string;
}) {
  const { write, generateId } = options;
  const filter = createProposalFenceFilter();
  // Provider-executed tool calls that have an input chunk but no output chunk yet.
  const openToolIds = new Set<string>();
  let textId: string | null = null;
  let visibleText = false;
  let deltaSeen = false;
  let result: ResultEvent | null = null;
  let permissionDenials = 0;
  let ignoredLines = 0;
  let proposalWritten = false;

  function emitText(text: string): void {
    if (text === "") {
      return;
    }
    if (textId === null) {
      textId = generateId();
      write({ type: "text-start", id: textId });
    }
    visibleText = true;
    write({ type: "text-delta", id: textId, delta: text });
  }

  function emitNotice(notice: string): void {
    emitText(visibleText ? `${NOTICE_SEPARATOR}${notice}` : notice);
  }

  function closeText(): void {
    if (textId !== null) {
      write({ type: "text-end", id: textId });
      textId = null;
    }
  }

  function handleToolUse(
    event: Extract<
      StreamJsonEvent,
      { kind: typeof StreamJsonEventKind.ToolUse }
    >,
    workDir: string
  ): void {
    if (!isAllowedTool(event.name)) {
      return;
    }
    closeText();
    openToolIds.add(event.id);
    const { toolName, target } = describeToolUse(event.input, workDir);
    write({
      type: "tool-input-available",
      toolCallId: event.id,
      toolName,
      input: { tool: event.name, target },
      providerExecuted: true,
    });
  }

  function handleToolResult(
    event: Extract<
      StreamJsonEvent,
      { kind: typeof StreamJsonEventKind.ToolResult }
    >
  ): void {
    if (!openToolIds.has(event.toolUseId)) {
      return;
    }
    openToolIds.delete(event.toolUseId);
    if (event.isError) {
      write({
        type: "tool-output-error",
        toolCallId: event.toolUseId,
        errorText: MapperNotice.FileUnavailable,
        providerExecuted: true,
      });
      return;
    }
    write({
      type: "tool-output-available",
      toolCallId: event.toolUseId,
      output: { ok: true },
      providerExecuted: true,
    });
  }

  // A stopped, timed-out or failed run can leave a tool part without output, which makes the
  // stored message fail validation on the next request.
  function closeOpenTools(): void {
    for (const toolCallId of openToolIds) {
      write({
        type: "tool-output-error",
        toolCallId,
        errorText: MapperNotice.ToolInterrupted,
        providerExecuted: true,
      });
    }
    openToolIds.clear();
  }

  function handleEvent(event: StreamJsonEvent, workDir: string): void {
    switch (event.kind) {
      case StreamJsonEventKind.TextDelta:
        deltaSeen = true;
        emitText(filter.push(event.text));
        break;
      case StreamJsonEventKind.ToolUse:
        handleToolUse(event, workDir);
        break;
      case StreamJsonEventKind.ToolResult:
        handleToolResult(event);
        break;
      case StreamJsonEventKind.PermissionDenied:
        permissionDenials += 1;
        break;
      case StreamJsonEventKind.Result:
        result = event;
        if (!deltaSeen && event.result) {
          emitText(filter.push(event.result));
        }
        break;
      default:
        break;
    }
  }

  function emitProposal(proposals: string[], unclosed: boolean): void {
    if (unclosed) {
      emitNotice(MapperNotice.ProposalCutOff);
      return;
    }
    const last = proposals.at(-1);
    if (last === undefined) {
      return;
    }
    const yaml = last.endsWith("\n") ? last.slice(0, -1) : last;
    if (yaml.trim() === "") {
      emitNotice(MapperNotice.ProposalEmpty);
      return;
    }
    const parsed = proposeWorkflowInputSchema.safeParse({ yaml });
    if (!parsed.success) {
      emitNotice(MapperNotice.ProposalTooLong);
      return;
    }
    closeText();
    proposalWritten = true;
    write({
      type: "tool-input-available",
      toolCallId: generateId(),
      toolName: WorkflowBuilderToolName.ProposeWorkflow,
      input: { yaml: parsed.data.yaml },
    });
  }

  return {
    begin(): void {
      write({ type: "start" });
      write({ type: "start-step" });
    },
    line(raw: string, workDir: string): void {
      const events = parseStreamJsonLine(raw);
      if (events === null) {
        ignoredLines += 1;
        return;
      }
      for (const event of events) {
        handleEvent(event, workDir);
      }
    },
    /** Closes tool calls and text that are still open when the run ends without `end()`. */
    abort(): void {
      closeOpenTools();
      closeText();
    },
    end(): StreamMapperEnd {
      const flushed = filter.finish();
      emitText(flushed.text);
      const outcome = toAgentRunOutcome(result);
      emitProposal(flushed.proposals, flushed.unclosed);
      if (outcome === AgentRunOutcome.MaxTurns) {
        emitNotice(MapperNotice.MaxTurns);
      }
      closeOpenTools();
      closeText();
      write({ type: "finish-step" });
      const resultSubtype = (result as ResultEvent | null)?.subtype;
      return {
        outcome,
        proposal: proposalWritten,
        permissionDenials,
        ignoredLines,
        resultSubtype,
      };
    },
  };
}

function isAllowedTool(name: string): boolean {
  return Object.values<string>(ClaudeCodeTool).includes(name);
}

const TARGET_KEYS = ["file_path", "path", "pattern"] as const;

const optionalString = z.string().optional().catch(undefined);
const toolInputSchema = z
  .looseObject({
    file_path: optionalString,
    path: optionalString,
    pattern: optionalString,
  })
  .catch({});

function describeToolUse(
  input: unknown,
  workDir: string
): { toolName: WorkflowBuilderToolName; target: string } {
  const record: Record<string, unknown> = toolInputSchema.parse(input);
  const strings = Object.values(record).filter(
    (value): value is string => typeof value === "string"
  );
  const isCatalog = strings.some((value) => value.includes(CATALOG_FILE));
  let target = "";
  for (const key of TARGET_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      target = candidate;
      break;
    }
  }
  return {
    toolName: isCatalog
      ? WorkflowBuilderToolName.GetCatalog
      : WorkflowBuilderToolName.ReadGuide,
    target: relativizeTarget(target, workDir),
  };
}

function relativizeTarget(target: string, workDir: string): string {
  const normalizedTarget = target.replaceAll("\\", "/");
  const normalizedRoot = workDir
    .replaceAll("\\", "/")
    .replace(TRAILING_SLASHES_RE, "");
  if (normalizedTarget === normalizedRoot) {
    return ".";
  }
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return target;
}
