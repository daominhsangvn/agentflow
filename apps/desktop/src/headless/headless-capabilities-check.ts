/**
 * @file headless-capabilities-check.ts
 * @description Checks a personal runner's `AGENTFLOW.md` on this computer with
 * the parser AgentFlow itself uses (docs/runner.md "Capabilities
 * (AGENTFLOW.md)"): the runner refuses to start on a file that does not parse,
 * never uploads such a file while running, and `check --project <key>` prints
 * the problems without starting.
 */

import fs from "node:fs";
import path from "node:path";
import {
  parseRunnerCapabilitiesMarkdown,
  RUNNER_CAPABILITIES_FILE_NAME,
  RUNNER_CAPABILITIES_MAX_CHARS,
  type RunnerCapabilities,
} from "@repo/api/src/types/runner-capabilities";
import { collectCapabilityWarningsIn } from "../server/operations/capability-warnings.js";

export const CapabilitiesFileStatus = {
  Missing: "missing",
  Invalid: "invalid",
  Valid: "valid",
} as const;
export type CapabilitiesFileStatus =
  (typeof CapabilitiesFileStatus)[keyof typeof CapabilitiesFileStatus];

export type CapabilitiesFileCheck =
  | { status: typeof CapabilitiesFileStatus.Missing; filePath: string }
  | {
      status: typeof CapabilitiesFileStatus.Invalid;
      filePath: string;
      problems: string[];
      content: string | null;
    }
  | {
      status: typeof CapabilitiesFileStatus.Valid;
      filePath: string;
      content: string;
      value: RunnerCapabilities;
    };

/** Equals `EXIT_CONFIG_ERROR` in headless-main.ts. */
export const CAPABILITIES_CHECK_EXIT_INVALID = 2;

type CheckLog = { info(message: string): void; error(message: string): void };

export function checkCapabilitiesFile(
  projectDir: string
): CapabilitiesFileCheck {
  const filePath = path.join(projectDir, RUNNER_CAPABILITIES_FILE_NAME);
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: CapabilitiesFileStatus.Missing, filePath };
    }
    return invalid(filePath, [`cannot be read: ${errorMessage(error)}`], null);
  }
  if (content.length > RUNNER_CAPABILITIES_MAX_CHARS) {
    return invalid(
      filePath,
      [
        `the file has ${content.length} characters; AgentFlow accepts at most ${RUNNER_CAPABILITIES_MAX_CHARS}`,
      ],
      content
    );
  }
  const parsed = parseRunnerCapabilitiesMarkdown(content);
  if (!parsed.ok) {
    return invalid(filePath, parsed.problems, content);
  }
  return {
    status: CapabilitiesFileStatus.Valid,
    filePath,
    content,
    value: parsed.value,
  };
}

export function formatCapabilitiesProblems(
  filePath: string,
  problems: readonly string[]
): string[] {
  return [
    `${filePath} is not valid (${problems.length} ${problemNoun(problems.length)}):`,
    ...problems.map((problem) => `  - ${problem}`),
  ];
}

/** True when the runner may start: the file is missing or valid. */
export function capabilitiesFileAllowsStart(
  projectDir: string,
  log: CheckLog,
  projectKey: string
): boolean {
  const result = checkCapabilitiesFile(projectDir);
  if (result.status === CapabilitiesFileStatus.Valid) {
    return true;
  }
  if (result.status === CapabilitiesFileStatus.Missing) {
    log.info(
      `No ${RUNNER_CAPABILITIES_FILE_NAME} in ${projectDir}: the orchestrator will not know this runner's commands`
    );
    return true;
  }
  for (const line of formatCapabilitiesProblems(
    result.filePath,
    result.problems
  )) {
    log.error(line);
  }
  log.error(
    `Cannot start: fix ${RUNNER_CAPABILITIES_FILE_NAME} and start again (check it with: node runner.mjs check --project ${projectKey})`
  );
  return false;
}

/** The `check --project <key>` command: prints the result, returns the exit code. */
export function runCapabilitiesCheck(input: {
  projectKey: string;
  projectDir: string;
  homeDir: string;
  write: (line: string) => void;
}): number {
  const result = checkCapabilitiesFile(input.projectDir);
  if (result.status === CapabilitiesFileStatus.Missing) {
    input.write(
      `No ${RUNNER_CAPABILITIES_FILE_NAME} in ${input.projectDir}: the Agent starts but uploads nothing`
    );
    return 0;
  }
  if (result.status === CapabilitiesFileStatus.Invalid) {
    for (const line of formatCapabilitiesProblems(
      result.filePath,
      result.problems
    )) {
      input.write(line);
    }
    return CAPABILITIES_CHECK_EXIT_INVALID;
  }
  input.write(
    `${result.filePath} is valid: ${result.value.commands.length} command(s), ${result.value.skills.length} skill(s)`
  );
  for (const warning of collectCapabilityWarnings(result.content, [
    input.projectDir,
    input.homeDir,
  ])) {
    input.write(`  warning: ${warning}`);
  }
  return 0;
}

/**
 * What only the runner can check: each declared command or skill exists in
 * `.claude/commands` or `.claude/skills` of one of the given folders (the
 * project folder, then the account's home). A plugin's command cannot be
 * checked this way, so the warning says so instead of calling it missing.
 */
export function collectCapabilityWarnings(
  content: string,
  roots: string[]
): string[] {
  return collectCapabilityWarningsIn(
    content,
    (rel) =>
      roots.some((root) => fs.existsSync(path.join(root, ...rel.split("/")))),
    "the project folder or ~/.claude"
  );
}

function invalid(
  filePath: string,
  problems: string[],
  content: string | null
): CapabilitiesFileCheck {
  return {
    status: CapabilitiesFileStatus.Invalid,
    filePath,
    problems,
    content,
  };
}

function problemNoun(count: number): string {
  return count === 1 ? "problem" : "problems";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
