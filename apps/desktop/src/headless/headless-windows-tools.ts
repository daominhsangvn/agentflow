/**
 * @file headless-windows-tools.ts
 * @description Makes a Windows machine look like what run-loop.sh and the
 * plugins expect from bash (docs/runner.md "Option D: Windows").
 *
 * Python and jq for Windows are installed as `python.exe` / `py.exe` and
 * `jq.exe`, and both write `\r\n` line endings, so every `$(python3 ...)` or
 * `$(jq -r ...)` value in a script would carry a trailing `\r`. The runner
 * writes a shims directory, prepended to the PATH of loop processes:
 *
 *   shims/python3                   runs the Python found on this machine
 *   shims/jq                        runs jq.exe with `--binary` (LF output)
 *   shims/python/sitecustomize.py   on PYTHONPATH: Python prints `\n`
 */

import fs from "node:fs";
import path from "node:path";
import type { BinaryPaths } from "../server/operations/binary-paths.js";
import {
  findGitBash,
  toShellPath,
  WINDOWS_SHIMS_DIR_ENV,
} from "../server/platform-shell.js";
import {
  findPython3Executable,
  type Python3Probe,
  probePython3Executable,
  resolveExecutablesOnPath,
} from "../server/shell-path.js";

const SHIMS_DIR_NAME = "shims";
const SHIM_MODE = 0o755;

const SITECUSTOMIZE = `# Written by the AgentFlow runner (Windows). Bash reads what Python prints,
# and a "\\r" before each newline would end up in every $(python3 ...) value.
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(newline="\\n")
    except (AttributeError, ValueError):
        pass
`;

/** What the runner found; null entries are reported missing by preflight. */
export type WindowsTools = {
  shimsDir: string;
  gitBash: string | null;
  python: string | null;
  jq: string | null;
};

export type WindowsToolsDeps = {
  env: NodeJS.ProcessEnv;
  /** sys.executable of a Python 3 run as `command args`, or null. */
  probePython: Python3Probe;
  findOnPath: (name: string) => Promise<string | null>;
  isFile: (file: string) => boolean;
  writeFile: (file: string, content: string) => void;
};

/**
 * Finds Git Bash, Python and jq, writes the shims for the ones found, and
 * points WINDOWS_SHIMS_DIR_ENV at them in `deps.env`. Call before the first
 * getShellPath(), which puts that directory first on PATH.
 */
export async function prepareWindowsTools(
  dataDir: string,
  deps: WindowsToolsDeps = defaultWindowsToolsDeps()
): Promise<WindowsTools> {
  const shimsDir = path.join(dataDir, SHIMS_DIR_NAME);
  const python = await findPython3Executable(deps.probePython);
  const jq = await deps.findOnPath("jq");
  if (python) {
    deps.writeFile(path.join(shimsDir, "python3"), execShim(python, []));
    deps.writeFile(
      path.join(shimsDir, "python", "sitecustomize.py"),
      SITECUSTOMIZE
    );
  }
  if (jq) {
    deps.writeFile(path.join(shimsDir, "jq"), execShim(jq, ["--binary"]));
  }
  deps.env[WINDOWS_SHIMS_DIR_ENV] = shimsDir;
  return {
    shimsDir,
    gitBash: findGitBash({ env: deps.env, isFile: deps.isFile }),
    python,
    jq,
  };
}

/** Preflight lookups for the tools bash scripts call by their POSIX names. */
export function windowsToolOverrides(
  tools: WindowsTools
): Record<string, string | null> {
  return { bash: tools.gitBash, python3: tools.python, jq: tools.jq };
}

/** A bash script that replaces itself with `target` (LF line endings). */
function execShim(target: string, args: string[]): string {
  // Shims exist on Windows only, where bash takes `C:/...` paths.
  const quoted = [toShellPath(target, "win32"), ...args]
    .map((part) => `'${part.replaceAll("'", String.raw`'\''`)}'`)
    .join(" ");
  return `#!/usr/bin/env bash\nexec ${quoted} "$@"\n`;
}

function defaultWindowsToolsDeps(): WindowsToolsDeps {
  return {
    env: process.env,
    probePython: probePython3Executable,
    findOnPath: async (name) =>
      (await resolveExecutablesOnPath(name, process.env.PATH ?? ""))[0] ?? null,
    isFile: (file) => fs.existsSync(file),
    writeFile: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, { mode: SHIM_MODE });
    },
  };
}

/** Gateway binary paths for the tools the runner detected (the health check and loop resolver use them). */
export function windowsBinaryPaths(tools: WindowsTools): BinaryPaths {
  return tools.python ? { python3: tools.python } : {};
}
