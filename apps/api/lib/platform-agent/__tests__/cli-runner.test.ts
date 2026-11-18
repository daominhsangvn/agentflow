import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeClaudeScratch,
  exists,
  FAKE_CLAUDE_COMMAND,
  isAlive,
  waitFor,
} from "@/__tests__/support/platform-agent/fake-claude.test-helpers";
import { buildClaudeChildEnv } from "../child-env";
import { buildClaudeArgs, RunEnd, runClaudeCli } from "../cli-runner";
import { ClaudeCodeTool } from "../stream-json";

const TEST_TIMEOUT_MS = 20_000;
const TOOLS = [
  ClaudeCodeTool.Read,
  ClaudeCodeTool.Grep,
  ClaudeCodeTool.Glob,
] as const;
const SYSTEM_PROMPT = "You are a test system prompt.";
const READY = "ready";

type Scratch = Awaited<ReturnType<typeof createFakeClaudeScratch>>;
let scratch: Scratch;
const leftoverDirs: string[] = [];

beforeEach(async () => {
  scratch = await createFakeClaudeScratch();
});

afterEach(async () => {
  await scratch.cleanup();
  leftoverDirs.push(scratch.dir);
});

function runWith(
  overrides: Partial<Parameters<typeof runClaudeCli>[0]> = {}
): ReturnType<typeof runClaudeCli> {
  const env = buildClaudeChildEnv({
    baseEnv: { ...process.env, DATABASE_URL: "postgres://secret-base-only" },
    settingsEnv: scratch.env(),
    configDir: `${scratch.dir}-config`,
  });
  return runClaudeCli({
    command: FAKE_CLAUDE_COMMAND,
    args: buildClaudeArgs({
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 7,
      tools: TOOLS,
    }),
    cwd: scratch.dir,
    env,
    stdin: "the prompt",
    onLine: () => undefined,
    timeoutMs: 15_000,
    ...overrides,
  });
}

async function childrenGone(): Promise<{ count: number; allGone: boolean }> {
  const pids = scratch.readChildPidsSync();
  const gone = await Promise.all(
    pids.map((pid) => waitFor(() => !isAlive(pid)))
  );
  return { count: pids.length, allGone: gone.every(Boolean) };
}

describe("buildClaudeArgs", () => {
  it("allows only the given tools, strict MCP, and keeps the prompt out of argv", () => {
    const args = buildClaudeArgs({
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 12,
      tools: TOOLS,
    });
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("12");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(SYSTEM_PROMPT);
  });
});

describe("runClaudeCli", () => {
  it(
    "passes argv, cwd, stdin and an allowlisted env",
    async () => {
      const prompt = `user text ${"é".repeat(150_000)}`;
      const result = await runWith({ stdin: prompt });
      expect(result).toEqual({
        end: RunEnd.Exited,
        exitCode: 0,
        droppedLines: 0,
      });
      const record = await scratch.readRecord();
      expect(record.argv).toEqual(
        buildClaudeArgs({
          systemPrompt: SYSTEM_PROMPT,
          maxTurns: 7,
          tools: TOOLS,
        })
      );
      expect(record.argv.join(" ")).not.toContain("user text");
      expect(record.stdin).toBe(prompt);
      expect(record.cwd.toLowerCase()).toBe(scratch.dir.toLowerCase());
      expect(record.env.CLAUDE_CONFIG_DIR).toBe(`${scratch.dir}-config`);
      expect(record.env.DISABLE_AUTOUPDATER).toBe("1");
      expect(record.env.DATABASE_URL).toBeUndefined();
      expect(record.env.HTTPS_PROXY).toBeUndefined();
    },
    TEST_TIMEOUT_MS
  );

  it(
    "delivers lines in order, including one split across writes",
    async () => {
      await scratch.writeScenario([
        "one",
        { write: "par" },
        { sleep: 80 },
        { write: "tial\r\n" },
        "",
        "three",
        { write: "last-without-newline" },
      ]);
      const lines: string[] = [];
      const result = await runWith({ onLine: (line) => lines.push(line) });
      expect(result.end).toBe(RunEnd.Exited);
      expect(lines).toEqual([
        "one",
        "partial",
        "three",
        "last-without-newline",
      ]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "reports a non-zero exit code",
    async () => {
      await scratch.writeScenario([{ exit: 3 }]);
      const result = await runWith();
      expect(result).toMatchObject({ end: RunEnd.Exited, exitCode: 3 });
    },
    TEST_TIMEOUT_MS
  );

  it(
    "drops a line over the size cap and keeps going",
    async () => {
      await scratch.writeScenario([
        "before",
        { big: 5 * 1024 * 1024 },
        "after",
      ]);
      const lines: string[] = [];
      const result = await runWith({ onLine: (line) => lines.push(line) });
      expect(lines).toEqual(["before", "after"]);
      expect(result.droppedLines).toBe(1);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "survives a throwing line consumer",
    async () => {
      await scratch.writeScenario(["a", "b"]);
      let calls = 0;
      const result = await runWith({
        onLine: () => {
          calls += 1;
          throw new Error("consumer failed");
        },
      });
      expect(result.end).toBe(RunEnd.Exited);
      expect(calls).toBe(2);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "kills the whole process tree on timeout",
    async () => {
      await scratch.writeScenario([
        { spawnChild: true },
        READY,
        { sleep: 30_000 },
      ]);
      let aliveAtReady = false;
      const result = await runWith({
        timeoutMs: 4000,
        onLine: () => {
          const pids = scratch.readChildPidsSync();
          aliveAtReady = pids.length > 0 && pids.every(isAlive);
        },
      });
      expect(result.end).toBe(RunEnd.Timeout);
      expect(aliveAtReady).toBe(true);
      const tree = await childrenGone();
      expect(tree.count).toBeGreaterThan(0);
      expect(tree.allGone).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "kills the whole process tree on abort",
    async () => {
      await scratch.writeScenario([
        { spawnChild: true },
        READY,
        { sleep: 30_000 },
      ]);
      const controller = new AbortController();
      const result = await runWith({
        abortSignal: controller.signal,
        onLine: (line) => {
          if (line === READY) {
            controller.abort();
          }
        },
      });
      expect(result.end).toBe(RunEnd.Aborted);
      const tree = await childrenGone();
      expect(tree.count).toBeGreaterThan(0);
      expect(tree.allGone).toBe(true);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "does not spawn when already aborted",
    async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await runWith({ abortSignal: controller.signal });
      expect(result).toEqual({
        end: RunEnd.Aborted,
        exitCode: null,
        droppedLines: 0,
      });
      expect(await scratch.recordExists()).toBe(false);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "reports a missing binary",
    async () => {
      const result = await runWith({
        command: {
          file: `${scratch.dir}/does-not-exist-claude`,
          prefixArgs: [],
        },
      });
      expect(result).toMatchObject({ end: RunEnd.SpawnFailed, exitCode: null });
    },
    TEST_TIMEOUT_MS
  );

  it("leaves no scratch dirs behind", async () => {
    expect(leftoverDirs.length).toBeGreaterThan(0);
    const present = await Promise.all(leftoverDirs.map((dir) => exists(dir)));
    expect(present.some(Boolean)).toBe(false);
  });
});
