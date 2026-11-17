import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ClaudeCodeCommand } from "@/lib/platform-agent/claude-code";

const FAKE_CLAUDE_PATH = path.join(import.meta.dirname, "fake-claude.mjs");

export const FAKE_CLAUDE_COMMAND: ClaudeCodeCommand = {
  file: process.execPath,
  prefixArgs: [FAKE_CLAUDE_PATH],
};

export const FakeClaudeEnv = {
  Record: "FAKE_CLAUDE_RECORD",
  Scenario: "FAKE_CLAUDE_SCENARIO",
  ChildPidFile: "FAKE_CLAUDE_CHILD_PID_FILE",
  Version: "FAKE_CLAUDE_VERSION",
} as const;

export type FakeClaudeRecord = {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  files: string[];
};

/**
 * Per-test scratch dir plus fake CLI plumbing. `cleanup()` kills only grandchildren whose pids the
 * fake CLI wrote to our own pid file, then removes the dir.
 */
export async function createFakeClaudeScratch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "af-fake-claude-"));
  const recordPath = path.join(dir, "record.json");
  const scenarioPath = path.join(dir, "scenario.json");
  const pidFile = path.join(dir, "child-pids.txt");
  return {
    dir,
    recordPath,
    /** Env entries to pass as settings env so the fake CLI records and plays the scenario. */
    env(): Record<string, string> {
      return {
        [FakeClaudeEnv.Record]: recordPath,
        [FakeClaudeEnv.Scenario]: scenarioPath,
        [FakeClaudeEnv.ChildPidFile]: pidFile,
      };
    },
    async writeScenario(steps: unknown[]): Promise<void> {
      await writeFile(scenarioPath, JSON.stringify(steps));
    },
    async readRecord(): Promise<FakeClaudeRecord> {
      return JSON.parse(await readFile(recordPath, "utf8")) as FakeClaudeRecord;
    },
    async recordExists(): Promise<boolean> {
      return await exists(recordPath);
    },
    async readChildPids(): Promise<number[]> {
      return await Promise.resolve(this.readChildPidsSync());
    },
    readChildPidsSync(): number[] {
      if (!existsSync(pidFile)) {
        return [];
      }
      return readFileSync(pidFile, "utf8")
        .split("\n")
        .filter((entry) => entry.trim() !== "")
        .map(Number);
    },
    async cleanup(): Promise<void> {
      for (const pid of await this.readChildPids()) {
        if (isAlive(pid)) {
          try {
            process.kill(pid);
          } catch {
            // already gone
          }
        }
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls until `check` is true; returns false when the budget runs out. */
export async function waitFor(
  check: () => boolean,
  budgetMs = 8000,
  stepMs = 50
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return check();
}

export async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
