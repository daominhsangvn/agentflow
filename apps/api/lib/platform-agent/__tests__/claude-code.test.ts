import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProbeRun } from "../claude-code";
import { ClaudeCodeSource, createClaudeCodeResolver } from "../claude-code";

const CLAUDE_BIN = process.platform === "win32" ? "claude.exe" : "claude";
let root: string;
let binDir: string;
let homeDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "af-cc-test-"));
  binDir = path.join(root, "bin");
  homeDir = path.join(root, "home");
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function versionsByFile(map: Record<string, string>): ProbeRun {
  return vi.fn((file: string) => {
    const version = map[file];
    return Promise.resolve(
      version
        ? { code: 0, stdout: `${version} (Claude Code)\n` }
        : { code: 1, stdout: "" }
    );
  });
}

async function touch(file: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "");
  return file;
}

describe("createClaudeCodeResolver", () => {
  it("finds claude on PATH (linux) and accepts any version for latest/unset", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const run = versionsByFile({ [file]: "2.1.100" });
    const resolver = createClaudeCodeResolver({
      run,
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    const unset = await resolver.resolve({});
    expect(unset).toMatchObject({
      ok: true,
      version: "2.1.100",
      source: ClaudeCodeSource.Path,
      command: { file, prefixArgs: [] },
    });
    const latest = await resolver.resolve({ requested: "latest" });
    expect(latest.ok).toBe(true);
  });

  it("looks for claude.exe on win32 and ignores claude.cmd", async () => {
    await touch(path.join(binDir, "claude.cmd"));
    const run = versionsByFile({});
    const resolver = createClaudeCodeResolver({
      run,
      platform: "win32",
      homeDir,
      baseEnv: { Path: binDir },
    });
    expect(await resolver.resolve({})).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    });
    const exe = await touch(path.join(binDir, "claude.exe"));
    const run2 = versionsByFile({ [exe]: "2.1.322" });
    const resolver2 = createClaudeCodeResolver({
      run: run2,
      platform: "win32",
      homeDir,
      baseEnv: { Path: binDir },
    });
    const result = await resolver2.resolve({});
    expect(result.ok).toBe(true);
  });

  it("prefers an explicit path", async () => {
    const onPath = await touch(path.join(binDir, CLAUDE_BIN));
    const explicit = path.join(root, "custom-claude");
    const run = versionsByFile({ [onPath]: "2.1.1", [explicit]: "2.1.2" });
    const resolver = createClaudeCodeResolver({
      run,
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    const result = await resolver.resolve({ explicitPath: explicit });
    expect(result).toMatchObject({
      ok: true,
      version: "2.1.2",
      source: ClaudeCodeSource.Explicit,
    });
  });

  it("accepts an exact match", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const resolver = createClaudeCodeResolver({
      run: versionsByFile({ [file]: "2.1.322" }),
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    expect(await resolver.resolve({ requested: "2.1.322" })).toMatchObject({
      ok: true,
      version: "2.1.322",
      source: ClaudeCodeSource.Path,
    });
  });

  it("falls back to the managed versions dir on an exact mismatch", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const managed = path.join(
      homeDir,
      ".local",
      "share",
      "claude",
      "versions",
      "2.1.322"
    );
    const resolver = createClaudeCodeResolver({
      run: versionsByFile({ [file]: "2.1.1", [managed]: "2.1.322" }),
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    expect(await resolver.resolve({ requested: "2.1.322" })).toMatchObject({
      ok: true,
      version: "2.1.322",
      source: ClaudeCodeSource.Managed,
      command: { file: managed },
    });
  });

  it("reports a mismatch with the found version", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const resolver = createClaudeCodeResolver({
      run: versionsByFile({ [file]: "2.1.1" }),
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    expect(await resolver.resolve({ requested: "2.1.322" })).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeVersionMismatch,
      foundVersion: "2.1.1",
    });
  });

  it("reports missing when nothing runs", async () => {
    const resolver = createClaudeCodeResolver({
      run: versionsByFile({}),
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    expect(await resolver.resolve({ requested: "2.1.322" })).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    });
  });

  it("treats garbage --version output as missing", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const run: ProbeRun = async () => ({ code: 0, stdout: "not a version\n" });
    const resolver = createClaudeCodeResolver({
      run,
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
    });
    expect(await resolver.resolve({ explicitPath: file })).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    });
  });

  it("caches within cacheMs and probes again afterwards", async () => {
    const file = await touch(path.join(binDir, CLAUDE_BIN));
    const run = versionsByFile({ [file]: "2.1.322" });
    let clock = 1000;
    const resolver = createClaudeCodeResolver({
      run,
      platform: process.platform,
      homeDir,
      baseEnv: { PATH: binDir },
      now: () => clock,
      cacheMs: 60_000,
    });
    await resolver.resolve({});
    await resolver.resolve({});
    expect(run).toHaveBeenCalledTimes(1);
    clock += 61_000;
    await resolver.resolve({});
    expect(run).toHaveBeenCalledTimes(2);
  });
});
