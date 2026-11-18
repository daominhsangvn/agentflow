import type { UIMessageChunk } from "@repo/ai";
import { WorkflowBuilderToolName } from "@repo/api/src/types/workflow-builder";
import { describe, expect, it } from "vitest";
import {
  NOISE_LINE,
  PERMISSION_DENIED_LINE,
  READ_CATALOG_TOOL_USE_LINE,
  READ_GUIDE_TOOL_USE_LINE,
  resultLine,
  SUCCESS_RUN_LINES,
  substituteWorkDir,
  textDeltaLine,
  toolResultLine,
} from "@/__tests__/support/platform-agent/stream-json-fixtures";
import { AgentRunOutcome } from "@/lib/platform-agent/stream-json";
import {
  createProposalFenceFilter,
  createStreamJsonMapper,
  MapperNotice,
} from "../stream-mapper";

const FENCE = "```workflow-yaml";
const CLOSE = "```";
const WORK_DIR =
  process.platform === "win32" ? String.raw`C:\tmp\af\work` : "/tmp/af/work";

function run(lines: readonly string[]) {
  const chunks: UIMessageChunk[] = [];
  let counter = 0;
  const mapper = createStreamJsonMapper({
    write: (chunk) => chunks.push(chunk),
    generateId: () => `id-${++counter}`,
  });
  mapper.begin();
  for (const line of substituteWorkDir(lines, WORK_DIR)) {
    mapper.line(line, WORK_DIR);
  }
  const end = mapper.end();
  return { chunks, end };
}

function textOf(chunks: UIMessageChunk[]): string {
  return chunks
    .flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
    .join("");
}

function findProposal(chunks: UIMessageChunk[]) {
  return chunks.find(
    (chunk) =>
      chunk.type === "tool-input-available" &&
      chunk.toolName === WorkflowBuilderToolName.ProposeWorkflow
  );
}

describe("createProposalFenceFilter", () => {
  function feed(parts: string[]) {
    const filter = createProposalFenceFilter();
    let text = "";
    for (const part of parts) {
      text += filter.push(part);
    }
    const end = filter.finish();
    return { ...end, text: text + end.text };
  }

  it("hides the fence when the marker is split mid-backticks", () => {
    const out = feed([
      "Hi\n`",
      "`",
      "`workflow-",
      "yaml\na: 1\n",
      "b: 2\n`",
      "``\nAfter",
    ]);
    expect(out.text).toBe("Hi\nAfter");
    expect(out.proposals).toEqual(["a: 1\nb: 2\n"]);
    expect(out.unclosed).toBe(false);
  });

  it("closes a fence at the end of the stream without a newline", () => {
    const out = feed([`${FENCE}\na: 1\n${CLOSE}`]);
    expect(out.proposals).toEqual(["a: 1\n"]);
    expect(out.text).toBe("");
  });

  it("allows trailing spaces and CR on the closing line", () => {
    const out = feed([`${FENCE}\r\na: 1\r\n${CLOSE}  \r\ndone`]);
    expect(out.proposals).toEqual(["a: 1\n"]);
    expect(out.text).toBe("done");
  });

  it("keeps every closed block", () => {
    const out = feed([
      `${FENCE}\na: 1\n${CLOSE}\nmid\n${FENCE}\nb: 2\n${CLOSE}\n`,
    ]);
    expect(out.proposals).toEqual(["a: 1\n", "b: 2\n"]);
    expect(out.text).toBe("mid\n");
  });

  it("flags an unclosed fence", () => {
    const out = feed([`${FENCE}\na: 1\n`]);
    expect(out.unclosed).toBe(true);
    expect(out.proposals).toEqual([]);
  });

  it("keeps plain yaml blocks and mid-line markers as text", () => {
    const input = `${CLOSE}yaml\na: 1\n${CLOSE}\nuse ${FENCE} inline\n`;
    const out = feed([input]);
    expect(out.text).toBe(input);
    expect(out.proposals).toEqual([]);
  });

  it("releases a held partial marker at the end", () => {
    expect(feed(["ok\n``"]).text).toBe("ok\n``");
  });
});

describe("createStreamJsonMapper", () => {
  it("emits chunks in order and one proposal tool part", () => {
    const { chunks, end } = run(SUCCESS_RUN_LINES);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "start-step",
      "tool-input-available",
      "tool-output-available",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-available",
      "finish-step",
    ]);
    const proposal = findProposal(chunks);
    expect(proposal).toMatchObject({
      input: { yaml: "name: Demo\nsteps: []" },
    });
    expect(proposal).not.toHaveProperty("providerExecuted");
    expect(textOf(chunks)).toBe("Here is the workflow.\n");
    expect(end).toMatchObject({
      outcome: AgentRunOutcome.Success,
      proposal: true,
    });
  });

  it("shows text after the fence and uses the last of two fences", () => {
    const { chunks } = run([
      textDeltaLine(
        `${FENCE}\na: 1\n${CLOSE}\nthen\n${FENCE}\nb: 2\n${CLOSE}\nbye`
      ),
      resultLine({}),
    ]);
    expect(textOf(chunks)).toBe("then\nbye");
    expect(findProposal(chunks)).toMatchObject({ input: { yaml: "b: 2" } });
  });

  it("notices an unclosed fence and writes no proposal", () => {
    const { chunks, end } = run([
      textDeltaLine(`x\n${FENCE}\na: 1\n`),
      resultLine({}),
    ]);
    expect(textOf(chunks)).toContain(MapperNotice.ProposalCutOff);
    expect(end.proposal).toBe(false);
  });

  it("notices a proposal over the size limit", () => {
    const big = "a".repeat(64_001);
    const { chunks, end } = run([
      textDeltaLine(`${FENCE}\n${big}\n${CLOSE}\n`),
      resultLine({}),
    ]);
    expect(textOf(chunks)).toBe(MapperNotice.ProposalTooLong);
    expect(end.proposal).toBe(false);
  });

  it("notices an empty proposal without the too-long text and writes no proposal", () => {
    const { chunks, end } = run([
      textDeltaLine(`${FENCE}\n${CLOSE}\n`),
      resultLine({}),
    ]);
    expect(textOf(chunks)).toBe(MapperNotice.ProposalEmpty);
    expect(textOf(chunks)).not.toContain("too long");
    expect(findProposal(chunks)).toBeUndefined();
    expect(end.proposal).toBe(false);
  });

  it("notices a blank-only proposal as empty", () => {
    const { chunks } = run([
      textDeltaLine(`${FENCE}\n  \n\n${CLOSE}\n`),
      resultLine({}),
    ]);
    expect(textOf(chunks)).toBe(MapperNotice.ProposalEmpty);
    expect(findProposal(chunks)).toBeUndefined();
  });

  it("closes a tool call whose result never arrived", () => {
    const { chunks } = run([READ_GUIDE_TOOL_USE_LINE, textDeltaLine("cut")]);
    const types = chunks.map((chunk) => chunk.type);
    expect(chunks).toContainEqual({
      type: "tool-output-error",
      toolCallId: "toolu_1",
      errorText: MapperNotice.ToolInterrupted,
      providerExecuted: true,
    });
    expect(types.indexOf("tool-output-error")).toBeLessThan(
      types.indexOf("finish-step")
    );
    expect(chunks.filter((c) => c.type === "tool-output-error")).toHaveLength(
      1
    );
  });

  it("closes open tool calls on abort without finishing the step", () => {
    const chunks: UIMessageChunk[] = [];
    const mapper = createStreamJsonMapper({
      write: (chunk) => chunks.push(chunk),
      generateId: () => "id",
    });
    mapper.begin();
    for (const line of substituteWorkDir(
      [READ_CATALOG_TOOL_USE_LINE],
      WORK_DIR
    )) {
      mapper.line(line, WORK_DIR);
    }
    mapper.abort();
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-error",
        toolCallId: "toolu_2",
      })
    );
    expect(chunks.some((c) => c.type === "finish-step")).toBe(false);
  });

  it("maps a tool call with a malformed input to a read_guide with no target", () => {
    const { chunks } = run([
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_9", name: "Read", input: "nope" },
          ],
        },
      }),
      toolResultLine("toolu_9"),
      resultLine({}),
    ]);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        toolCallId: "toolu_9",
        toolName: WorkflowBuilderToolName.ReadGuide,
        input: { tool: "Read", target: "" },
      })
    );
  });

  it("keeps plain yaml blocks as text", () => {
    const block = `${CLOSE}yaml\na: 1\n${CLOSE}`;
    const { chunks, end } = run([textDeltaLine(block), resultLine({})]);
    expect(textOf(chunks)).toBe(block);
    expect(end.proposal).toBe(false);
  });

  it("maps guide and catalog reads with relative targets", () => {
    const { chunks } = run([
      READ_GUIDE_TOOL_USE_LINE,
      toolResultLine("toolu_1"),
      READ_CATALOG_TOOL_USE_LINE,
      toolResultLine("toolu_2", true),
      resultLine({}),
    ]);
    const guide = chunks.find(
      (c) => c.type === "tool-input-available" && c.toolCallId === "toolu_1"
    );
    const catalog = chunks.find(
      (c) => c.type === "tool-input-available" && c.toolCallId === "toolu_2"
    );
    expect(guide).toMatchObject({
      toolName: WorkflowBuilderToolName.ReadGuide,
      input: { tool: "Read", target: "guides/yaml-reference.md" },
      providerExecuted: true,
    });
    expect(catalog).toMatchObject({
      toolName: WorkflowBuilderToolName.GetCatalog,
      input: { target: "catalog.json" },
    });
    expect(JSON.stringify(chunks)).not.toContain("af/work");
    expect(chunks).toContainEqual({
      type: "tool-output-error",
      toolCallId: "toolu_2",
      errorText: MapperNotice.FileUnavailable,
      providerExecuted: true,
    });
    expect(chunks).toContainEqual({
      type: "tool-output-available",
      toolCallId: "toolu_1",
      output: { ok: true },
      providerExecuted: true,
    });
  });

  it("counts permission denials and ignored lines", () => {
    const { end } = run([
      PERMISSION_DENIED_LINE,
      NOISE_LINE,
      NOISE_LINE,
      resultLine({}),
    ]);
    expect(end.permissionDenials).toBe(1);
    expect(end.ignoredLines).toBe(2);
  });

  it("falls back to the result text when no deltas streamed", () => {
    const { chunks } = run([resultLine({ result: "Plain answer" })]);
    expect(textOf(chunks)).toBe("Plain answer");
  });

  it("adds a notice on max turns", () => {
    const { chunks, end } = run([
      textDeltaLine("partial"),
      resultLine({ subtype: "error_max_turns", isError: true }),
    ]);
    expect(end.outcome).toBe(AgentRunOutcome.MaxTurns);
    expect(end.resultSubtype).toBe("error_max_turns");
    expect(textOf(chunks)).toBe(`partial\n\n${MapperNotice.MaxTurns}`);
  });

  it("reports cli errors and missing results", () => {
    const failed = run([
      resultLine({ subtype: "error_during_execution", isError: true }),
    ]);
    expect(failed.end.outcome).toBe(AgentRunOutcome.CliError);
    const noResult = run([textDeltaLine("cut")]);
    expect(noResult.end.outcome).toBe(AgentRunOutcome.NoResult);
    expect(textOf(noResult.chunks)).toBe("cut");
  });

  it("never writes finish or error", () => {
    const { chunks } = run(SUCCESS_RUN_LINES);
    expect(chunks.some((c) => c.type === "finish" || c.type === "error")).toBe(
      false
    );
    expect(chunks.at(-1)).toEqual({ type: "finish-step" });
  });
});
