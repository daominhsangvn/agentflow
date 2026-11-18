import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_CODE_RELEASE_RE,
  ClaudeCodeVersionChannel,
} from "@repo/api/src/types/compute-target-model-provider";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import { log } from "@repo/observability/log";
import type { EnvLike } from "./child-env";
import { buildProbeEnv } from "./child-env";

export type ClaudeCodeCommand = { file: string; prefixArgs: string[] };

export const ClaudeCodeSource = {
  Explicit: "explicit",
  Path: "path",
  Managed: "managed",
} as const;
export type ClaudeCodeSource =
  (typeof ClaudeCodeSource)[keyof typeof ClaudeCodeSource];

export type ClaudeCodeResolution =
  | {
      ok: true;
      command: ClaudeCodeCommand;
      version: string;
      source: ClaudeCodeSource;
    }
  | {
      ok: false;
      reason: PlatformAgentDisabledReason;
      foundVersion?: string;
    };

export type ProbeRun = (
  file: string,
  args: string[]
) => Promise<{ code: number; stdout: string }>;

export type ClaudeCodeResolveInput = {
  requested?: string;
  explicitPath?: string;
};

type ResolverOptions = {
  run?: ProbeRun;
  platform?: NodeJS.Platform;
  homeDir?: string;
  baseEnv?: EnvLike;
  now?: () => number;
  cacheMs?: number;
};

const WHITESPACE_RE = /\s+/;
const DEFAULT_CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_MAX_BUFFER = 1024 * 1024;

export function createClaudeCodeResolver(options: ResolverOptions = {}) {
  const platform = options.platform ?? process.platform;
  const baseEnv = options.baseEnv ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const run = options.run ?? createDefaultProbe(baseEnv, platform);
  const cache = new Map<string, { at: number; value: ClaudeCodeResolution }>();
  let lastOutcome: string | null = null;
  let lastResolved: string | null = null;

  async function resolveUncached(
    input: ClaudeCodeResolveInput
  ): Promise<ClaudeCodeResolution> {
    const candidate = await findCandidate(input, baseEnv, platform);
    const candidateVersion = candidate
      ? await probeVersion(run, candidate.file)
      : null;
    const requested = input.requested;
    const exact =
      requested !== undefined && requested !== ClaudeCodeVersionChannel.Latest;

    if (!exact) {
      if (candidate && candidateVersion) {
        return okResolution(candidate, candidateVersion);
      }
      return {
        ok: false,
        reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
      };
    }
    if (candidate && candidateVersion === requested) {
      return okResolution(candidate, candidateVersion);
    }
    const managedFile = path.join(
      homeDir,
      ".local",
      "share",
      "claude",
      "versions",
      requested
    );
    const managedVersion = await probeVersion(run, managedFile);
    if (managedVersion === requested) {
      return okResolution(
        { file: managedFile, source: ClaudeCodeSource.Managed },
        managedVersion
      );
    }
    if (candidateVersion) {
      return {
        ok: false,
        reason: PlatformAgentDisabledReason.ClaudeCodeVersionMismatch,
        foundVersion: candidateVersion,
      };
    }
    return {
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    };
  }

  function report(
    input: ClaudeCodeResolveInput,
    value: ClaudeCodeResolution
  ): void {
    if (value.ok) {
      const key = `${value.version}|${value.source}`;
      lastOutcome = null;
      if (key !== lastResolved) {
        lastResolved = key;
        log.info("platform_agent.claude_code_resolved", {
          version: value.version,
          source: value.source,
        });
      }
      return;
    }
    const key = `${value.reason}|${value.foundVersion ?? ""}`;
    lastResolved = null;
    if (key !== lastOutcome) {
      lastOutcome = key;
      log.warn("platform_agent.claude_code_unavailable", {
        reason: value.reason,
        requested: input.requested,
        foundVersion: value.foundVersion,
        error: null,
      });
    }
  }

  return {
    async resolve(
      input: ClaudeCodeResolveInput
    ): Promise<ClaudeCodeResolution> {
      const key = [
        input.requested ?? "",
        input.explicitPath ?? "",
        pathValue(baseEnv),
      ].join("|");
      const cached = cache.get(key);
      if (cached && now() - cached.at < cacheMs) {
        return cached.value;
      }
      const value = await resolveUncached(input);
      cache.set(key, { at: now(), value });
      report(input, value);
      return value;
    },
  };
}

function okResolution(
  candidate: { file: string; source: ClaudeCodeSource },
  version: string
): ClaudeCodeResolution {
  return {
    ok: true,
    command: { file: candidate.file, prefixArgs: [] },
    version,
    source: candidate.source,
  };
}

function pathValue(baseEnv: EnvLike): string {
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.toUpperCase() === "PATH" && typeof value === "string") {
      return value;
    }
  }
  return "";
}

async function findCandidate(
  input: ClaudeCodeResolveInput,
  baseEnv: EnvLike,
  platform: NodeJS.Platform
): Promise<{ file: string; source: ClaudeCodeSource } | null> {
  if (input.explicitPath) {
    return { file: input.explicitPath, source: ClaudeCodeSource.Explicit };
  }
  const found = await findOnPath(pathValue(baseEnv), platform);
  return found ? { file: found, source: ClaudeCodeSource.Path } : null;
}

async function findOnPath(
  pathList: string,
  platform: NodeJS.Platform
): Promise<string | null> {
  const delimiter = platform === "win32" ? ";" : ":";
  const name = platform === "win32" ? "claude.exe" : "claude";
  for (const dir of pathList.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const file = path.join(dir, name);
    if (await isFile(file)) {
      return file;
    }
  }
  return null;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    // observability: a missing candidate is the expected "not found" outcome
    return false;
  }
}

async function probeVersion(
  run: ProbeRun,
  file: string
): Promise<string | null> {
  const result = await run(file, ["--version"]);
  if (result.code !== 0) {
    return null;
  }
  const token = result.stdout.trim().split(WHITESPACE_RE)[0] ?? "";
  return CLAUDE_CODE_RELEASE_RE.exec(token) ? token : null;
}

function createDefaultProbe(
  baseEnv: EnvLike,
  platform: NodeJS.Platform
): ProbeRun {
  return (file, args) =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        {
          // The project's ProcessEnv type requires NODE_ENV; a child env must not carry it.
          env: buildProbeEnv(baseEnv, platform) as NodeJS.ProcessEnv,
          timeout: PROBE_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: PROBE_MAX_BUFFER,
        },
        (error, stdout) => {
          if (!error) {
            resolve({ code: 0, stdout: String(stdout) });
            return;
          }
          const code = (error as NodeJS.ErrnoException & { code?: unknown })
            .code;
          resolve({
            code: typeof code === "number" ? code : 1,
            stdout: String(stdout ?? ""),
          });
        }
      );
    });
}
