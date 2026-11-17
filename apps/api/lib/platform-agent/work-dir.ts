import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { log } from "@repo/observability/log";

/** A file to write under the work dir: relative, `/`-separated path. */
export type AgentWorkDirFile = { path: string; content: string };

export type AgentWorkDir = {
  root: string;
  workDir: string;
  configDir: string;
  dispose(): Promise<void>;
};

const DIR_MODE = 0o700;
const CLEANUP_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 200;
const INVALID_PATH_MESSAGE = "invalid agent work dir path";
const INVALID_SEGMENTS = new Set(["", ".", ".."]);

/**
 * Per-run temp directory: `work/` (the CLI's cwd, holding the given files) and a sibling
 * `config/` (the CLI's isolated CLAUDE_CONFIG_DIR, never inside the cwd).
 */
export async function createAgentWorkDir(input: {
  files: readonly AgentWorkDirFile[];
  tmpRoot?: string;
}): Promise<AgentWorkDir> {
  assertValidPaths(input.files);
  const root = await mkdtemp(
    path.join(input.tmpRoot ?? os.tmpdir(), "af-agent-")
  );
  const workDir = path.join(root, "work");
  const configDir = path.join(root, "config");
  const handle: AgentWorkDir = {
    root,
    workDir,
    configDir,
    dispose: () => removeRoot(root),
  };
  try {
    await mkdir(workDir, { mode: DIR_MODE });
    await mkdir(configDir, { mode: DIR_MODE });
    for (const file of input.files) {
      const target = path.join(workDir, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true, mode: DIR_MODE });
      await writeFile(target, file.content);
    }
  } catch (error) {
    await handle.dispose();
    throw error;
  }
  return handle;
}

function assertValidPaths(files: readonly AgentWorkDirFile[]): void {
  const seen = new Set<string>();
  for (const { path: filePath } of files) {
    if (!isValidRelativePath(filePath) || seen.has(filePath)) {
      throw new Error(INVALID_PATH_MESSAGE);
    }
    seen.add(filePath);
  }
}

function isValidRelativePath(filePath: string): boolean {
  if (
    filePath === "" ||
    filePath.includes("\\") ||
    path.posix.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath)
  ) {
    return false;
  }
  return filePath.split("/").every((segment) => !INVALID_SEGMENTS.has(segment));
}

async function removeRoot(root: string): Promise<void> {
  try {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: CLEANUP_RETRIES,
      retryDelay: CLEANUP_RETRY_DELAY_MS,
    });
  } catch (error) {
    log.warn("platform_agent.work_dir_cleanup_failed", {
      reason: "work_dir_cleanup_failed",
      error,
    });
  }
}
