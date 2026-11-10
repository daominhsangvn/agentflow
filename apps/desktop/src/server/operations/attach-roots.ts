import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  attachRootPath,
  isSafeAttachPattern,
  PROJECT_ATTACH_ROOT,
  splitAttachGlob,
} from "@agentflow-ai/loops-api/loop-step";
import {
  parseRunnerCapabilitiesMarkdown,
  RUNNER_CAPABILITIES_FILE_NAME,
} from "@repo/api/src/types/runner-capabilities";

/**
 * Named attach roots of a personal Agent: `<name>:<glob>` in a command's
 * `attach` resolves `<name>` only from the Agent's own AGENTFLOW.md at
 * collection time, never from the step, and every match is realpath-contained
 * in its root.
 */

/** One collected or refused file of a named attach glob. */
export type NamedAttachEntry = {
  path: string;
  file: string;
  skipped?: string;
};

/** The `attachRoots` of the AGENTFLOW.md in `projectDir`, or why there are none. */
export function readLocalAttachRoots(
  projectDir: string
): { roots: Record<string, string> } | { error: string } {
  let content: string;
  try {
    content = readFileSync(
      path.join(projectDir, RUNNER_CAPABILITIES_FILE_NAME),
      "utf8"
    );
  } catch {
    return { error: `${RUNNER_CAPABILITIES_FILE_NAME} is missing` };
  }
  const parsed = parseRunnerCapabilitiesMarkdown(content);
  if (!parsed.ok) {
    return { error: `${RUNNER_CAPABILITIES_FILE_NAME} does not parse` };
  }
  return { roots: parsed.value.attachRoots ?? {} };
}

/** The real folder of a root name, or null when it is missing or not a folder. */
export function resolveAttachRootDir(
  name: string,
  roots: Record<string, string>,
  projectDir: string,
  homeDir: string = os.homedir()
): string | null {
  let dir: string;
  if (name === PROJECT_ATTACH_ROOT) {
    dir = projectDir;
  } else if (Object.hasOwn(roots, name)) {
    dir = declaredRootPath(roots[name], projectDir, homeDir);
  } else {
    return null;
  }
  try {
    const real = realpathSync.native(dir);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Files of the named globs (`<name>:<pattern>`), reported as
 * `<name>:<relative>`. A glob that cannot be collected becomes a skipped
 * entry with the reason.
 */
export function collectNamedAttachEntries(input: {
  projectDir: string;
  globs: readonly string[];
  match: (root: string, globs: readonly string[]) => string[];
  homeDir?: string;
}): NamedAttachEntry[] {
  const local = readLocalAttachRoots(input.projectDir);
  const entries: NamedAttachEntry[] = [];
  for (const glob of input.globs) {
    entries.push(...collectNamedGlob(glob, local, input));
  }
  return entries;
}

function collectNamedGlob(
  glob: string,
  local: ReturnType<typeof readLocalAttachRoots>,
  input: {
    projectDir: string;
    match: (root: string, globs: readonly string[]) => string[];
    homeDir?: string;
  }
): NamedAttachEntry[] {
  const { root: name, pattern } = splitAttachGlob(glob);
  if (name === null || !isSafeAttachPattern(pattern)) {
    return [skippedGlob(glob, "not a relative glob")];
  }
  if ("error" in local && name !== PROJECT_ATTACH_ROOT) {
    return [skippedGlob(glob, local.error)];
  }
  const roots = "roots" in local ? local.roots : {};
  const known = name === PROJECT_ATTACH_ROOT || Object.hasOwn(roots, name);
  if (!known) {
    return [
      skippedGlob(
        glob,
        `${name} is not in attachRoots of this Agent's ${RUNNER_CAPABILITIES_FILE_NAME}`
      ),
    ];
  }
  const rootReal = resolveAttachRootDir(
    name,
    roots,
    input.projectDir,
    input.homeDir
  );
  if (rootReal === null) {
    return [skippedGlob(glob, `folder of ${name} not found`)];
  }
  return input
    .match(rootReal, [pattern])
    .map((relative) => containedEntry(name, rootReal, relative))
    .filter((entry): entry is NamedAttachEntry => entry !== null);
}

function containedEntry(
  name: string,
  rootReal: string,
  relative: string
): NamedAttachEntry | null {
  const reported = attachRootPath(name, relative);
  let real: string;
  try {
    real = realpathSync.native(path.join(rootReal, relative));
  } catch {
    return { path: reported, file: "", skipped: `outside ${name}` };
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    return { path: reported, file: "", skipped: `outside ${name}` };
  }
  if (isHiddenProjectFile(name, path.relative(rootReal, real))) {
    return null;
  }
  return { path: reported, file: real };
}

function isHiddenProjectFile(name: string, relative: string): boolean {
  return (
    name === PROJECT_ATTACH_ROOT &&
    relative
      .split(path.sep)
      .some((segment) => segment.toLowerCase() === ".agentflow-ai")
  );
}

function skippedGlob(glob: string, reason: string): NamedAttachEntry {
  return { path: glob, file: "", skipped: reason };
}

function declaredRootPath(
  declared: string,
  projectDir: string,
  homeDir: string
): string {
  if (declared === "~" || declared.startsWith("~/")) {
    return path.join(homeDir, declared.slice(1));
  }
  return path.resolve(projectDir, declared);
}
