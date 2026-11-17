import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UIMessage, UIMessageChunk } from "@repo/ai";
import { WorkflowBuilderToolName } from "@repo/api/src/types/workflow-builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeClaudeScratch,
  FAKE_CLAUDE_COMMAND,
} from "@/__tests__/support/platform-agent/fake-claude.test-helpers";
import {
  PERMISSION_DENIED_LINE,
  READ_CATALOG_TOOL_USE_LINE,
  resultLine,
  SUCCESS_RUN_LINES,
  textDeltaLine,
  toolResultLine,
} from "@/__tests__/support/platform-agent/stream-json-fixtures";
import { RunEnd } from "@/lib/platform-agent/cli-runner";
import { AgentRunOutcome } from "@/lib/platform-agent/stream-json";
import { runWorkflowBuilderChat } from "../chat-run";
import type { KnowledgeGuide } from "../knowledge";

const TEST_TIMEOUT_MS = 20_000;
const USER_TEXT = "please add a cron trigger";
const EDITOR_YAML = "name: current-editor-marker\n";

const GUIDE: KnowledgeGuide = {
  id: "yaml-reference",
  title: "YAML reference",
  kind: "reference",
  source: "docs/workflows.md",
  text: "# Reference",
};

const MESSAGES: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: USER_TEXT }] },
];

type Scratch = Awaited<ReturnType<typeof createFakeClaudeScratch>>;
let scratch: Scratch;
let tmpRoot: string;

beforeEach(async () => {
  scratch = await createFakeClaudeScratch();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "af-chat-run-test-"));
});

afterEach(async () => {
  await scratch.cleanup();
  await rm(tmpRoot, { recursive: true, force: true });
});

function chat(
  overrides: Partial<Parameters<typeof runWorkflowBuilderChat>[0]> = {}
) {
  const chunks: UIMessageChunk[] = [];
  let counter = 0;
  const promise = runWorkflowBuilderChat({
    command: FAKE_CLAUDE_COMMAND,
    settingsEnv: scratch.env(),
    guides: [GUIDE],
    catalog: { projects: [] },
    messages: MESSAGES,
    editorYaml: EDITOR_YAML,
    write: (chunk) => chunks.push(chunk),
    baseEnv: { ...process.env },
    generateId: () => `id-${++counter}`,
    tmpRoot,
    ...overrides,
  });
  return { chunks, promise };
}

describe("runWorkflowBuilderChat", () => {
  it(
    "streams a proposal and feeds the CLI the work dir files and the prompt on stdin",
    async () => {
      await scratch.writeScenario([...SUCCESS_RUN_LINES]);
      const { chunks, promise } = chat();
      const result = await promise;
      expect(result).toMatchObject({
        end: RunEnd.Exited,
        outcome: AgentRunOutcome.Success,
        proposal: true,
        exitCode: 0,
      });
      expect(chunks[0]).toEqual({ type: "start" });
      expect(chunks[1]).toEqual({ type: "start-step" });
      expect(chunks.at(-1)).toEqual({ type: "finish-step" });
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: "tool-input-available",
          toolName: WorkflowBuilderToolName.ProposeWorkflow,
          input: { yaml: "name: Demo\nsteps: []" },
        })
      );
      const record = await scratch.readRecord();
      expect(record.files).toEqual([
        "README.md",
        "catalog.json",
        "current-editor.yaml",
        "guides/yaml-reference.md",
      ]);
      expect(record.stdin).toContain(USER_TEXT);
      expect(record.stdin).toContain("current-editor-marker");
      expect(record.argv.join(" ")).not.toContain(USER_TEXT);
      expect(record.argv.join(" ")).not.toContain("current-editor-marker");
      expect(record.argv[record.argv.indexOf("--tools") + 1]).toBe(
        "Read,Grep,Glob"
      );
      expect(record.argv[record.argv.indexOf("--max-turns") + 1]).toBe("12");
      expect(await readdir(tmpRoot)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "maps catalog reads relative to the real work dir",
    async () => {
      await scratch.writeScenario([
        READ_CATALOG_TOOL_USE_LINE,
        toolResultLine("toolu_2"),
        textDeltaLine("done"),
        resultLine({}),
      ]);
      const { chunks, promise } = chat();
      await promise;
      expect(chunks).toContainEqual(
        expect.objectContaining({
          toolName: WorkflowBuilderToolName.GetCatalog,
          input: { tool: "Read", target: "catalog.json" },
        })
      );
    },
    TEST_TIMEOUT_MS
  );

  it(
    "reports a CLI error result after a permission denial",
    async () => {
      await scratch.writeScenario([
        PERMISSION_DENIED_LINE,
        resultLine({ subtype: "error_during_execution", isError: true }),
        { exit: 1 },
      ]);
      const { chunks, promise } = chat();
      const result = await promise;
      expect(result).toMatchObject({
        outcome: AgentRunOutcome.CliError,
        permissionDenials: 1,
        proposal: false,
        exitCode: 1,
      });
      expect(chunks.at(-1)).toEqual({ type: "finish-step" });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "closes a read tool call when the run is killed before its result (timeout)",
    async () => {
      await scratch.writeScenario([
        READ_CATALOG_TOOL_USE_LINE,
        { sleep: 30_000 },
      ]);
      const { chunks, promise } = chat({ timeoutMs: 2500 });
      const result = await promise;
      expect(result.end).toBe(RunEnd.Timeout);
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: "tool-output-error",
          toolCallId: "toolu_2",
          providerExecuted: true,
        })
      );
      expect(chunks.at(-1)).toEqual({ type: "finish-step" });
      expect(await readdir(tmpRoot)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "closes a read tool call when the run is aborted before its result",
    async () => {
      await scratch.writeScenario([
        READ_CATALOG_TOOL_USE_LINE,
        { sleep: 30_000 },
      ]);
      const controller = new AbortController();
      const chunks: UIMessageChunk[] = [];
      const { promise } = chat({
        abortSignal: controller.signal,
        write: (chunk) => {
          chunks.push(chunk);
          if (chunk.type === "tool-input-available") {
            controller.abort();
          }
        },
      });
      const result = await promise;
      expect(result.end).toBe(RunEnd.Aborted);
      expect(chunks).toContainEqual(
        expect.objectContaining({
          type: "tool-output-error",
          toolCallId: "toolu_2",
        })
      );
      expect(chunks.some((chunk) => chunk.type === "finish-step")).toBe(false);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "writes nothing after an abort and returns no outcome",
    async () => {
      await scratch.writeScenario([textDeltaLine("hello"), { sleep: 30_000 }]);
      const controller = new AbortController();
      const chunks: UIMessageChunk[] = [];
      const { promise } = chat({
        abortSignal: controller.signal,
        // Abort once the run has produced its first chunk after begin().
        write: (chunk) => {
          chunks.push(chunk);
          if (chunk.type === "text-delta") {
            controller.abort();
          }
        },
      });
      const result = await promise;
      expect(result).toMatchObject({ end: RunEnd.Aborted, outcome: null });
      expect(chunks.some((chunk) => chunk.type === "finish-step")).toBe(false);
      expect(await readdir(tmpRoot)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );
});
