import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentWorkDir } from "../work-dir";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), "af-wd-test-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("createAgentWorkDir", () => {
  it("writes files including nested paths", async () => {
    const wd = await createAgentWorkDir({
      files: [
        { path: "a.txt", content: "A" },
        { path: "dir/sub/b.txt", content: "B" },
      ],
      tmpRoot,
    });
    expect(await readFile(path.join(wd.workDir, "a.txt"), "utf8")).toBe("A");
    expect(
      await readFile(path.join(wd.workDir, "dir", "sub", "b.txt"), "utf8")
    ).toBe("B");
    await wd.dispose();
  });

  it("keeps the config dir as an empty sibling of the work dir", async () => {
    const wd = await createAgentWorkDir({ files: [], tmpRoot });
    expect(path.dirname(wd.configDir)).toBe(path.dirname(wd.workDir));
    expect(wd.configDir.startsWith(wd.workDir + path.sep)).toBe(false);
    expect((await stat(wd.configDir)).isDirectory()).toBe(true);
    expect(await readdir(wd.configDir)).toEqual([]);
    await wd.dispose();
  });

  it.each([
    ["parent segment", ["../x"]],
    ["posix absolute", ["/x"]],
    ["windows absolute", ["C:\\x"]],
    ["backslash", ["a\\b"]],
    ["empty segment", ["a//b"]],
    ["empty path", [""]],
    ["duplicate", ["a", "a"]],
  ])("rejects an invalid path (%s) before creating anything", async (_name, paths) => {
    await expect(
      createAgentWorkDir({
        files: paths.map((p) => ({ path: p, content: "x" })),
        tmpRoot,
      })
    ).rejects.toThrow("invalid agent work dir path");
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("removes the root and rethrows when a write fails", async () => {
    await expect(
      createAgentWorkDir({
        files: [
          { path: "a", content: "x" },
          { path: "a/b", content: "y" },
        ],
        tmpRoot,
      })
    ).rejects.toThrow();
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("dispose removes the root and is idempotent", async () => {
    const wd = await createAgentWorkDir({
      files: [{ path: "a", content: "x" }],
      tmpRoot,
    });
    await wd.dispose();
    expect(await readdir(tmpRoot)).toEqual([]);
    await expect(wd.dispose()).resolves.toBeUndefined();
  });
});
