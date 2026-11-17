import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeClaudeScratch,
  FAKE_CLAUDE_COMMAND,
  isAlive,
  waitFor,
} from "@/__tests__/support/platform-agent/fake-claude.test-helpers";
import { runPlatformAgent } from "../agent-run";
import { RunEnd } from "../cli-runner";
import { ClaudeCodeTool } from "../stream-json";

const TEST_TIMEOUT_MS = 20_000;
const FILES = [
  { path: "README.md", content: "# readme" },
  { path: "guides/a.md", content: "guide A" },
];
const PROMPT = "secret-user-prompt";

type Scratch = Awaited<ReturnType<typeof createFakeClaudeScratch>>;
let scratch: Scratch;
let tmpRoot: string;

beforeEach(async () => {
  scratch = await createFakeClaudeScratch();
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "af-agent-run-test-"));
});

afterEach(async () => {
  await scratch.cleanup();
  await rm(tmpRoot, { recursive: true, force: true });
});

function run(overrides: Partial<Parameters<typeof runPlatformAgent>[0]> = {}) {
  return runPlatformAgent({
    command: FAKE_CLAUDE_COMMAND,
    settingsEnv: scratch.env(),
    files: FILES,
    systemPrompt: "system",
    prompt: PROMPT,
    tools: [ClaudeCodeTool.Read, ClaudeCodeTool.Grep],
    maxTurns: 5,
    timeoutMs: 15_000,
    onLine: () => undefined,
    baseEnv: { ...process.env, DATABASE_URL: "postgres://secret-base-only" },
    tmpRoot,
    ...overrides,
  });
}

describe("runPlatformAgent", () => {
  it(
    "runs the CLI in a work dir holding the files and removes it afterwards",
    async () => {
      const result = await run();
      expect(result).toMatchObject({ end: RunEnd.Exited, exitCode: 0 });
      const record = await scratch.readRecord();
      expect(record.files).toEqual(["README.md", "guides/a.md"]);
      expect(path.basename(record.cwd)).toBe("work");
      expect(path.basename(record.env.CLAUDE_CONFIG_DIR)).toBe("config");
      expect(path.dirname(record.env.CLAUDE_CONFIG_DIR)).toBe(
        path.dirname(record.cwd)
      );
      expect(record.stdin).toBe(PROMPT);
      expect(record.argv).toContain("--strict-mcp-config");
      expect(record.argv[record.argv.indexOf("--tools") + 1]).toBe("Read,Grep");
      expect(record.argv[record.argv.indexOf("--max-turns") + 1]).toBe("5");
      expect(record.argv.join(" ")).not.toContain(PROMPT);
      expect(record.env.DATABASE_URL).toBeUndefined();
      expect(await readdir(tmpRoot)).toEqual([]);
    },
    TEST_TIMEOUT_MS
  );

  it(
    "passes each line with the work dir and cleans up after a timeout",
    async () => {
      await scratch.writeScenario([
        { spawnChild: true },
        "ready",
        { sleep: 30_000 },
      ]);
      const seen: { line: string; workDir: string }[] = [];
      const result = await run({
        timeoutMs: 4000,
        onLine: (line, context) =>
          seen.push({ line, workDir: context.workDir }),
      });
      expect(result.end).toBe(RunEnd.Timeout);
      expect(seen.map((entry) => entry.line)).toEqual(["ready"]);
      expect(path.basename(seen[0].workDir)).toBe("work");
      expect(await readdir(tmpRoot)).toEqual([]);
      const pids = scratch.readChildPidsSync();
      expect(pids.length).toBeGreaterThan(0);
      for (const pid of pids) {
        expect(await waitFor(() => !isAlive(pid))).toBe(true);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    "cleans up after an abort",
    async () => {
      await scratch.writeScenario([
        { spawnChild: true },
        "ready",
        { sleep: 30_000 },
      ]);
      const controller = new AbortController();
      const result = await run({
        abortSignal: controller.signal,
        onLine: () => controller.abort(),
      });
      expect(result.end).toBe(RunEnd.Aborted);
      expect(await readdir(tmpRoot)).toEqual([]);
      for (const pid of scratch.readChildPidsSync()) {
        expect(await waitFor(() => !isAlive(pid))).toBe(true);
      }
    },
    TEST_TIMEOUT_MS
  );

  it(
    "rejects invalid file paths without touching the tmp root",
    async () => {
      await expect(
        run({ files: [{ path: "../escape.txt", content: "x" }] })
      ).rejects.toThrow();
      expect(await readdir(tmpRoot)).toEqual([]);
      expect(await scratch.recordExists()).toBe(false);
    },
    TEST_TIMEOUT_MS
  );
});
