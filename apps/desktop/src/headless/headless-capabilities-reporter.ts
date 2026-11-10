/**
 * @file headless-capabilities-reporter.ts
 * @description Uploads a personal runner's `AGENTFLOW.md` (docs/runner.md
 * "Capabilities (AGENTFLOW.md)"): the commands and skills its owner declares
 * in the project folder, so the project's orchestrator knows what this runner
 * can do. The file is read when the runner connects and again whenever it
 * changes; the runner adds the warnings only it can see (a declared command
 * that is not in `.claude/commands` or `.claude/skills`), and the API parses
 * the front matter itself. The runner checks the front matter with the shared
 * parser and never uploads a file that does not parse (the API keeps the last
 * valid one). The runner also sends this computer's own role,
 * which replaces the file's `runner:` (the file is shared by many computers).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import {
  RUNNER_CAPABILITIES_FILE_NAME,
  RunnerCapabilitiesSource,
} from "@repo/api/src/types/runner-capabilities";
import { gatewayLog } from "../main/logging/gateway-logger.js";
import {
  type CapabilitiesFileCheck,
  CapabilitiesFileStatus,
  checkCapabilitiesFile,
  collectCapabilityWarnings,
  formatCapabilitiesProblems,
} from "./headless-capabilities-check.js";

const LOG_TAG = "headless-capabilities";
const TRAILING_SLASHES_RE = /\/+$/;
/** Editors write a file in several steps: upload once it settles. */
export const CAPABILITIES_WATCH_DEBOUNCE_MS = 1000;

type Watcher = { close(): void };

export type CapabilitiesReporterDeps = {
  apiUrl: string;
  apiKey: string;
  /** The AgentFlow project key of the personal runner, e.g. PRO-1. */
  projectKey: string;
  projectDir: string;
  /** The account's home, whose `~/.claude` also holds commands and skills. */
  homeDir?: string;
  /** This computer's role (replaces the file's runner:); null: none. */
  role: string | null;
  getComputeTargetId: () => string | null;
  fetchImpl?: typeof fetch;
  watch?: (dir: string, onChange: (fileName: string | null) => void) => Watcher;
  debounceMs?: number;
};

export type HeadlessCapabilitiesReporter = {
  /** Uploads the file now (the runner just connected, or the file changed). */
  report(options?: { force?: boolean }): Promise<void>;
  stop(): void;
};

export function startHeadlessCapabilitiesReporter(
  deps: CapabilitiesReporterDeps
): HeadlessCapabilitiesReporter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const homeDir = deps.homeDir ?? os.homedir();
  let uploadedHash: string | null = null;
  let missingLogged = false;
  let invalidLogged: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const upload = async (
    computeTargetId: string,
    content: string,
    hash: string,
    warnings: string[]
  ) => {
    const url = `${deps.apiUrl.replace(TRAILING_SLASHES_RE, "")}/compute-targets/${encodeURIComponent(computeTargetId)}/capabilities`;
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project: deps.projectKey,
          source: RunnerCapabilitiesSource.Personal,
          content,
          warnings,
          ...roleField(deps.role),
        }),
      });
      if (response.ok) {
        uploadedHash = hash;
        gatewayLog.info(
          LOG_TAG,
          `Uploaded ${RUNNER_CAPABILITIES_FILE_NAME} for ${deps.projectKey}`
        );
        return;
      }
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      gatewayLog.warn(
        LOG_TAG,
        `Uploading ${RUNNER_CAPABILITIES_FILE_NAME} answered ${response.status}: ${detail}`
      );
    } catch (error) {
      gatewayLog.warn(
        LOG_TAG,
        `Uploading ${RUNNER_CAPABILITIES_FILE_NAME} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const report = async (options: { force?: boolean } = {}) => {
    const computeTargetId = deps.getComputeTargetId();
    if (stopped || !computeTargetId) {
      return;
    }
    const checked = checkCapabilitiesFile(deps.projectDir);
    if (checked.status === CapabilitiesFileStatus.Missing) {
      invalidLogged = null;
      if (!missingLogged) {
        logMissing(deps.projectDir);
        missingLogged = true;
      }
      return;
    }
    missingLogged = false;
    if (checked.status === CapabilitiesFileStatus.Invalid) {
      invalidLogged = logInvalidOnce(checked, invalidLogged);
      return;
    }
    if (invalidLogged !== null) {
      gatewayLog.info(
        LOG_TAG,
        `${RUNNER_CAPABILITIES_FILE_NAME} is valid again`
      );
      invalidLogged = null;
    }
    const content = checked.content;
    const hash = uploadHash(content);
    if (!options.force && hash === uploadedHash) {
      return;
    }
    const warnings = collectCapabilityWarnings(content, [
      deps.projectDir,
      homeDir,
    ]);
    for (const warning of warnings) {
      gatewayLog.warn(LOG_TAG, `${RUNNER_CAPABILITIES_FILE_NAME}: ${warning}`);
    }
    await upload(computeTargetId, content, hash, warnings);
  };

  const watch = deps.watch ?? watchDirectory;
  let watcher: Watcher | null = null;
  try {
    watcher = watch(deps.projectDir, (fileName) => {
      if (fileName !== null && fileName !== RUNNER_CAPABILITIES_FILE_NAME) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        report().catch(() => undefined);
      }, deps.debounceMs ?? CAPABILITIES_WATCH_DEBOUNCE_MS);
      timer.unref?.();
    });
  } catch (error) {
    gatewayLog.warn(
      LOG_TAG,
      `Cannot watch ${deps.projectDir} for ${RUNNER_CAPABILITIES_FILE_NAME} changes: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    report,
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      watcher?.close();
    },
  };
}

function watchDirectory(
  dir: string,
  onChange: (fileName: string | null) => void
): Watcher {
  const watcher = fs.watch(dir, { persistent: false }, (_event, fileName) =>
    onChange(fileName === null ? null : String(fileName))
  );
  watcher.on("error", (error) =>
    gatewayLog.warn(LOG_TAG, `Watching ${dir} failed: ${error.message}`)
  );
  return watcher;
}

/** What an upload is deduplicated by: the file (the role cannot change while running). */
function uploadHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function roleField(role: string | null): { role?: string } {
  return role ? { role } : {};
}

function logMissing(projectDir: string): void {
  gatewayLog.info(
    LOG_TAG,
    `No ${RUNNER_CAPABILITIES_FILE_NAME} in ${projectDir}: the orchestrator will not know this runner's commands`
  );
}

/** Logs an invalid file's problems unless this exact content was logged already; returns the new key. */
function logInvalidOnce(
  checked: Extract<
    CapabilitiesFileCheck,
    { status: typeof CapabilitiesFileStatus.Invalid }
  >,
  logged: string | null
): string {
  const key = uploadHash(checked.content ?? checked.problems.join("\n"));
  if (key === logged) {
    return key;
  }
  for (const line of formatCapabilitiesProblems(
    checked.filePath,
    checked.problems
  )) {
    gatewayLog.error(LOG_TAG, line);
  }
  gatewayLog.error(
    LOG_TAG,
    `Not uploaded: AgentFlow keeps the last valid ${RUNNER_CAPABILITIES_FILE_NAME}`
  );
  return key;
}
