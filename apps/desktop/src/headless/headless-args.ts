/**
 * @file headless-args.ts
 * @description Command line of the headless runner bundle (headless-main.ts):
 *
 *   node runner.mjs                                   the auto runner
 *   node runner.mjs --project <key> [--role "<role>"] the personal runner of a project
 *   node runner.mjs setup [--project <key>]           asks the setup questions
 *   node runner.mjs uninstall [--project <key>]       removes the Windows service
 *   node runner.mjs check --project <key>             validates the project's AGENTFLOW.md
 */

import {
  RUNNER_ROLE_MAX_CHARS,
  runnerRoleSchema,
} from "@repo/api/src/types/runner-capabilities";
import { normalizeProjectKey } from "./headless-env.js";

export const SETUP_COMMAND = "setup";
export const UNINSTALL_COMMAND = "uninstall";
export const CHECK_COMMAND = "check";
/** `--project <key>`: the personal runner of that AgentFlow project. */
export const PROJECT_OPTION = "--project";
/** `--role <role>`: this computer's role, replacing the file's `runner:`. */
export const ROLE_OPTION = "--role";

export type RunnerArgs = {
  setup: boolean;
  uninstall: boolean;
  check: boolean;
  projectKey: string | null;
  role: string | null;
};

export type RunnerArgsResult =
  | { ok: true; value: RunnerArgs }
  | { ok: false; error: string };

type OptionResult =
  | { ok: true; consumed: number }
  | { ok: false; error: string };

/** `[setup|uninstall|check] [--project <key>] [--role <role>]`. */
export function parseRunnerArgs(argv: readonly string[]): RunnerArgsResult {
  const value: RunnerArgs = {
    setup: false,
    uninstall: false,
    check: false,
    projectKey: null,
    role: null,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === SETUP_COMMAND && index === 0) {
      value.setup = true;
      continue;
    }
    if (arg === UNINSTALL_COMMAND && index === 0) {
      value.uninstall = true;
      continue;
    }
    if (arg === CHECK_COMMAND && index === 0) {
      value.check = true;
      continue;
    }
    const option = readOption(value, arg, argv[index + 1]);
    if (!option.ok) {
      return option;
    }
    index += option.consumed;
  }
  const invalid = validateCombination(value);
  if (invalid) {
    return { ok: false, error: invalid };
  }
  return { ok: true, value };
}

function validateCombination(value: RunnerArgs): string | null {
  if (value.check && !value.projectKey) {
    return `${CHECK_COMMAND} validates a personal Agent's AGENTFLOW.md: use it with ${PROJECT_OPTION} <key>, e.g. node runner.mjs ${CHECK_COMMAND} ${PROJECT_OPTION} PRO-1`;
  }
  if (
    value.role &&
    (!value.projectKey || value.setup || value.uninstall || value.check)
  ) {
    return `${ROLE_OPTION} sets the role of a running personal Agent: use it with ${PROJECT_OPTION} <key>, e.g. node runner.mjs ${PROJECT_OPTION} PRO-1 ${ROLE_OPTION} "Dev (LeaveDesk, An)"`;
  }
  return null;
}

function readOption(
  value: RunnerArgs,
  arg: string | undefined,
  next: string | undefined
): OptionResult {
  if (arg === PROJECT_OPTION) {
    const key = normalizeProjectKey(next ?? "");
    if (!key) {
      return {
        ok: false,
        error: `${PROJECT_OPTION} needs an AgentFlow project key, e.g. ${PROJECT_OPTION} PRO-1`,
      };
    }
    value.projectKey = key;
    return { ok: true, consumed: 1 };
  }
  if (arg === ROLE_OPTION) {
    const role = runnerRoleSchema.safeParse(next ?? "");
    if (!role.success) {
      return {
        ok: false,
        error: `${ROLE_OPTION} needs a role of at most ${RUNNER_ROLE_MAX_CHARS} characters, e.g. ${ROLE_OPTION} "Dev (LeaveDesk, An)"`,
      };
    }
    value.role = role.data;
    return { ok: true, consumed: 1 };
  }
  return {
    ok: false,
    error: `Unknown argument "${arg}": run without arguments (auto runner), with "${PROJECT_OPTION} <project key>" [${ROLE_OPTION} "<role>"] (personal runner), "${SETUP_COMMAND}", "${UNINSTALL_COMMAND}" or "${CHECK_COMMAND} ${PROJECT_OPTION} <key>"`,
  };
}
