import fs, { constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executableFileNames, isWindows } from "../platform-shell.js";
import {
  getShellEnv,
  KNOWN_BINARY_LOCATIONS,
  resolveExecutablesOnPath,
} from "../shell-path.js";
import type { CommandError } from "./health-check-plugin-enable.js";
import type { GatewayCheckResult as CheckResult } from "./health-check-types.js";

/**
 * Per-binary override of the hardcoded KNOWN_*_LOCATIONS arrays consulted
 * by collectBinaryDebug. Used to make tests host-independent: a test that
 * asserts on "Not found" can pass `{ claude: [] }` so the host's actual
 * Homebrew/local install does not leak into `foundAt[]`. Production never
 * sets this.
 */
let knownLocationsForTest: Record<string, string[]> | null = null;

// Canonical known-install-location lists live in shell-path.ts, where they
// also drive the resolver's known-location tier (FEA-3742). Re-derive the
// per-binary diagnostics arrays from that single source so the resolver and
// the "found at X but not on PATH" diagnostics never drift.
export const KNOWN_CLAUDE_LOCATIONS: string[] =
  KNOWN_BINARY_LOCATIONS.claude ?? [];
export const KNOWN_GIT_LOCATIONS: string[] = KNOWN_BINARY_LOCATIONS.git ?? [];
export const KNOWN_PYTHON3_LOCATIONS: string[] =
  KNOWN_BINARY_LOCATIONS.python3 ?? [];

export async function collectBinaryDebug(
  binaryName: string,
  spawnError: CommandError,
  knownLocations: string[]
): Promise<NonNullable<CheckResult["debug"]>> {
  const env = await getShellEnv();
  const shellPath = env.PATH ?? "";

  const pathHits = await resolveExecutablesOnPath(binaryName, shellPath);
  const seen = new Set<string>(pathHits);

  // Sweep PATH directories and known install locations, distinguishing
  // executable hits from files that exist but are not executable. The
  // latter drive EACCES diagnostics so remediation points at the actual
  // broken file rather than some other executable location.
  const candidates = binaryDebugCandidates(
    binaryName,
    shellPath,
    knownLocations
  );

  const knownHits: string[] = [];
  const nonExecutableHits: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      await fs.access(candidate, constants.F_OK);
    } catch {
      // observability: b — probe, absence is a normal state
      continue; // does not exist
    }
    try {
      await fs.access(candidate, constants.X_OK);
      knownHits.push(candidate);
    } catch {
      // observability: b — probe, absence is a normal state
      nonExecutableHits.push(candidate);
    }
  }

  return {
    errorCode: spawnError.code,
    stderr: spawnError.stderr,
    resolvedPath: shellPath.slice(0, 1024),
    shell: path.basename(process.env.SHELL ?? ""),
    platform: process.platform,
    foundAt: [...pathHits, ...knownHits],
    ...(nonExecutableHits.length > 0
      ? { nonExecutableAt: nonExecutableHits }
      : {}),
  };
}

export function classifyBinaryError(
  binaryName: string,
  spawnError: CommandError,
  debug: NonNullable<CheckResult["debug"]>
): string {
  const { errorCode } = debug;
  const foundAt = debug.foundAt ?? [];
  const nonExecutableAt = debug.nonExecutableAt ?? [];

  if (errorCode === "ENOENT") {
    if (foundAt.length > 0) {
      return `Found at ${foundAt[0]} but not on PATH`;
    }
    return "Not found";
  }

  if (errorCode === "EACCES" || errorCode === "EPERM") {
    // Prefer a path that actually has the permission problem over any
    // unrelated executable hit, so the error points at the real offender.
    const brokenPath = nonExecutableAt[0] ?? foundAt[0];
    if (brokenPath) {
      return `Found at ${brokenPath} but not executable`;
    }
    return "Permission denied";
  }

  if (errorCode === "ETIMEDOUT") {
    if (foundAt.length > 0) {
      return `Timed out running ${foundAt[0]} --version`;
    }
    return `Timed out running ${binaryName} --version`;
  }

  const raw = `${spawnError.code}: ${spawnError.stderr || spawnError.message}`;
  return raw.slice(0, 80);
}

export function classifyBinaryRemediation(
  binaryName: string,
  _spawnError: CommandError,
  debug: NonNullable<CheckResult["debug"]>
): string {
  const { errorCode } = debug;
  const foundAt = debug.foundAt ?? [];
  const nonExecutableAt = debug.nonExecutableAt ?? [];
  const shell = debug.shell || "shell";
  const platform = debug.platform ?? process.platform;

  if (errorCode === "ENOENT") {
    if (foundAt.length > 0) {
      return pathRemediation(foundAt[0], shell, platform);
    }
    return getInstallRemediation(binaryName, platform);
  }

  if (errorCode === "EACCES" || errorCode === "EPERM") {
    const brokenPath = nonExecutableAt[0] ?? foundAt[0];
    if (brokenPath) {
      return `chmod +x ${brokenPath}`;
    }
    return `Check executable permissions on your ${binaryName} install`;
  }

  if (errorCode === "ETIMEDOUT") {
    return `Try \`${binaryName} --version\` in a terminal -- it may be hanging on startup`;
  }

  return "See diagnostics tab for details";
}

/**
 * @internal Test-only (via `_setKnownBinaryLocationsForTesting`). Override the
 * KNOWN_*_LOCATIONS arrays per-binary so a test can assert on a clean
 * "no-installed-binary-anywhere" state without being defeated by the host
 * machine's Homebrew/native installs. Pass `null` to restore defaults.
 */
export function setKnownBinaryLocationsOverride(
  override: Record<string, string[]> | null
): void {
  knownLocationsForTest = override;
}

export function getInstallRemediation(
  binaryName: string,
  platform: NodeJS.Platform
): string {
  switch (binaryName) {
    case "claude":
      return "Install: npm install -g @anthropic-ai/claude-code";
    case "codex":
      return "Install: npm install -g @openai/codex";
    case "git":
      return gitInstallRemediation(platform);
    case "gh":
      return ghInstallRemediation(platform);
    case "python3":
      return python3InstallRemediation(platform);
    default:
      return `Install ${binaryName}`;
  }
}

/**
 * Candidate file paths for the debug sweep. On Windows only executable
 * file names (name + PATHEXT) are emitted, never the extensionless bash shim.
 */
export function binaryDebugCandidates(
  binaryName: string,
  shellPath: string,
  knownLocations: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const p = isWindows(platform) ? path.win32 : path.posix;
  const candidates: string[] = [];
  const segments = shellPath
    .split(p.delimiter)
    .map((segment) => segment.trim())
    .filter(Boolean);
  for (const segment of segments) {
    for (const fileName of executableFileNames(binaryName, platform, env)) {
      candidates.push(p.join(segment, fileName));
    }
  }
  for (const location of effectiveKnownLocations(binaryName, knownLocations)) {
    const expanded = expandTilde(location);
    for (const fileName of executableFileNames(
      p.basename(expanded),
      platform,
      env
    )) {
      candidates.push(p.join(p.dirname(expanded), fileName));
    }
  }
  return candidates;
}

function effectiveKnownLocations(
  binaryName: string,
  defaults: string[]
): string[] {
  return knownLocationsForTest?.[binaryName] ?? defaults;
}

function gitInstallRemediation(platform: NodeJS.Platform): string {
  if (isWindows(platform)) {
    return "Install Git for Windows: winget install Git.Git (or see https://git-scm.com)";
  }
  if (platform === "darwin") {
    return "Install: xcode-select --install";
  }
  if (platform === "linux") {
    return "Install via your package manager (e.g. apt install git, dnf install git)";
  }
  return "Install Git: see https://git-scm.com";
}

function ghInstallRemediation(platform: NodeJS.Platform): string {
  if (isWindows(platform)) {
    return "Install the GitHub CLI: winget install GitHub.cli (or see https://cli.github.com)";
  }
  if (platform === "darwin") {
    return "Install: brew install gh (or see https://cli.github.com)";
  }
  if (platform === "linux") {
    return "Install the GitHub CLI: see https://github.com/cli/cli/blob/trunk/docs/install_linux.md";
  }
  return "Install the GitHub CLI: see https://cli.github.com";
}

function python3InstallRemediation(platform: NodeJS.Platform): string {
  if (isWindows(platform)) {
    return 'Install Python 3.10 or later: winget install Python.Python.3.12 (or see https://python.org and tick "Add python.exe to PATH")';
  }
  if (platform === "darwin") {
    return "Install Python 3.10 or later: brew install python@3.13 (or see https://python.org)";
  }
  if (platform === "linux") {
    return "Install Python 3.10 or later via your package manager (e.g. apt install python3)";
  }
  return "Install Python 3.10 or later: see https://python.org";
}

function pathRemediation(
  foundAt: string,
  shell: string,
  platform: NodeJS.Platform
): string {
  if (isWindows(platform)) {
    return `Add ${path.win32.dirname(foundAt)} to your user PATH environment variable (Settings > System > About > Advanced system settings > Environment Variables), then restart the app`;
  }
  return `Add ${path.dirname(foundAt)} to PATH in your ${shell} rc, then restart the app`;
}

function expandTilde(loc: string): string {
  if (loc.startsWith("~/")) {
    return os.homedir() + loc.slice(1);
  }
  if (loc === "~") {
    return os.homedir();
  }
  return loc;
}
