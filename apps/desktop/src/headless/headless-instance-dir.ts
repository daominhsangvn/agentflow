/**
 * @file headless-instance-dir.ts
 * @description Which data directory a personal Agent uses. One per agent name:
 * `<data dir>/personal/<agent slug>`, flat. The project an Agent belongs to is
 * the AGENTFLOW_RUNNER_PROJECT_KEY of that directory's runner.env. Pure
 * helpers; file system reads are injected through InstanceDirFs.
 */

import fs from "node:fs";
import path from "node:path";

import {
  HeadlessRunnerEnv,
  normalizeProjectKey,
  PERSONAL_DATA_DIR_NAME,
} from "./headless-env.js";
import {
  asciiName,
  readRunnerConfigFile,
  runnerConfigFile,
} from "./headless-setup.js";

export const NAME_OPTION = "--name";
const PROJECT_OPTION_NAME = "--project";
const AGENT_SLUG_MAX_LENGTH = 40;
const DIGITS_RE = /^\d+$/;
const EDGE_DASHES_RE = /^-+|-+$/g;

export type AgentSettings = {
  projectKey: string | null;
  runnerName: string | null;
};

export type InstanceDirFs = {
  exists(dir: string): boolean;
  /** Entry names of a directory; [] when it does not exist. */
  listDir(dir: string): string[];
  /** Project key and runner name of `<dir>/runner.env`; null fields when absent. */
  readAgentSettings(dir: string): AgentSettings;
};

export type PersonalAgent = {
  slug: string;
  projectKey: string | null;
  runnerName: string | null;
  dataDir: string;
};

export type ResolvePersonalAgentResult =
  | { ok: true; agent: PersonalAgent | null }
  | { ok: false; error: string };

export type ChooseAgentResult =
  | { ok: true; agent: PersonalAgent; picked: boolean }
  | { ok: "ask"; candidates: PersonalAgent[] }
  | { ok: false; error: string };

/** The folder-safe slug of an agent name; null when it has no letter or digit. */
export function agentNameSlug(name: string): string | null {
  const slug = asciiName(name)
    .toLowerCase()
    .slice(0, AGENT_SLUG_MAX_LENGTH)
    .replaceAll(EDGE_DASHES_RE, "");
  return slug === "" ? null : slug;
}

/**
 * The default of the setup Name question: the saved name when its slug is the
 * slug of the typed `--name` (the Agent already exists, keep its spelling),
 * else the typed name.
 */
export function setupNameDefault(
  typedName: string,
  savedName: string | undefined
): string {
  const saved = savedName?.trim();
  if (saved && agentNameSlug(saved) === agentNameSlug(typedName)) {
    return saved;
  }
  return typedName;
}

export function personalAgentDir(baseDataDir: string, slug: string): string {
  return path.join(baseDataDir, PERSONAL_DATA_DIR_NAME, slug);
}

/** `--name slug` when there is a slug, else `--project K` (used in hints). */
export function personalAgentOptions(
  projectKey: string,
  slug: string | null
): string {
  return slug
    ? `${NAME_OPTION} ${slug}`
    : `${PROJECT_OPTION_NAME} ${projectKey}`;
}

/** The personal Agents set up on this computer, sorted by slug. */
export function listPersonalAgents(
  baseDataDir: string,
  fsApi: InstanceDirFs
): PersonalAgent[] {
  const root = path.join(baseDataDir, PERSONAL_DATA_DIR_NAME);
  return fsApi
    .listDir(root)
    .filter((entry) => agentNameSlug(entry) === entry)
    .map((slug) => ({ slug, dataDir: path.join(root, slug) }))
    .filter((entry) => fsApi.exists(entry.dataDir))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((entry) => ({ ...entry, ...fsApi.readAgentSettings(entry.dataDir) }));
}

export function agentsOfProject(
  agents: PersonalAgent[],
  projectKey: string
): PersonalAgent[] {
  return agents.filter((agent) => agent.projectKey === projectKey);
}

export function findPersonalAgent(
  baseDataDir: string,
  slug: string,
  fsApi: InstanceDirFs
): PersonalAgent | null {
  return (
    listPersonalAgents(baseDataDir, fsApi).find(
      (agent) => agent.slug === slug
    ) ?? null
  );
}

export function resolvePersonalAgent(
  options: {
    baseDataDir: string;
    projectKey: string | null;
    name: string | null;
  },
  fsApi: InstanceDirFs
): ResolvePersonalAgentResult {
  if (options.name !== null) {
    return resolveByName(options, options.name, fsApi);
  }
  if (options.projectKey === null) {
    return { ok: true, agent: null };
  }
  return resolveByProject(options.baseDataDir, options.projectKey, fsApi);
}

/**
 * Which of a key's Agents (null key: of all this computer's personal
 * Agents) starts. One Agent is used as is. With several, a
 * terminal picks the single one not running or asks; without a terminal the
 * choice must be explicit (--name), so a unit never starts another Agent.
 */
export function chooseAgentToStart(
  projectKey: string | null,
  agents: PersonalAgent[],
  isRunning: (dataDir: string) => boolean,
  interactive: boolean
): ChooseAgentResult {
  if (agents.length === 1) {
    return { ok: true, agent: agents[0], picked: false };
  }
  const scope = projectKey ? ` of ${projectKey}` : "";
  if (!interactive) {
    const choices = agents
      .map((agent) => {
        const running = isRunning(agent.dataDir) ? " (running)" : "";
        return `${NAME_OPTION} ${agent.slug}${running}`;
      })
      .join(" or ");
    return {
      ok: false,
      error: `Several personal Agents${scope} are set up on this computer: start one with ${choices}`,
    };
  }
  const free = agents.filter((agent) => !isRunning(agent.dataDir));
  if (free.length === 0) {
    const names = agents.map((agent) => agent.slug).join(", ");
    return {
      ok: false,
      error: `Every personal Agent${scope} on this computer is already running: ${names}`,
    };
  }
  if (free.length === 1) {
    return { ok: true, agent: free[0], picked: true };
  }
  return { ok: "ask", candidates: free };
}

/** A 1-based number or a name (compared by slug) from the candidates. */
export function parseAgentChoice(
  answer: string,
  candidates: PersonalAgent[]
): PersonalAgent | null {
  const text = answer.trim();
  if (DIGITS_RE.test(text)) {
    return candidates[Number(text) - 1] ?? null;
  }
  const slug = agentNameSlug(text);
  if (slug === null) {
    return null;
  }
  return candidates.find((agent) => agent.slug === slug) ?? null;
}

/** An error text when `name` cannot be the name of an Agent of `projectKey`; else null. */
export function checkPersonalAgentName(
  baseDataDir: string,
  projectKey: string,
  name: string,
  fsApi: InstanceDirFs
): string | null {
  const slug = agentNameSlug(name);
  if (slug === null) {
    return "must contain a letter or digit (it names this Agent's folder)";
  }
  const existing = findPersonalAgent(baseDataDir, slug, fsApi);
  if (
    existing !== null &&
    existing.projectKey !== null &&
    existing.projectKey !== projectKey
  ) {
    return `"${name}" is already the name of a personal Agent of ${existing.projectKey} on this computer: choose another name`;
  }
  return null;
}

export function defaultInstanceDirFs(): InstanceDirFs {
  return {
    exists: (dir) => fs.existsSync(dir),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        // observability: probe — a missing directory is empty
        return [];
      }
    },
    readAgentSettings: (dir) => {
      try {
        const config = readRunnerConfigFile(runnerConfigFile(dir));
        return {
          projectKey: normalizeProjectKey(
            config[HeadlessRunnerEnv.ProjectKey] ?? ""
          ),
          runnerName: config[HeadlessRunnerEnv.RunnerName]?.trim() || null,
        };
      } catch {
        // observability: parse fallback — an unreadable config has no settings
        return { projectKey: null, runnerName: null };
      }
    },
  };
}

function resolveByName(
  options: { baseDataDir: string; projectKey: string | null },
  name: string,
  fsApi: InstanceDirFs
): ResolvePersonalAgentResult {
  const slug = agentNameSlug(name);
  if (slug === null) {
    return {
      ok: false,
      error: `--name needs an agent name with a letter or digit, got "${name}"`,
    };
  }
  const agents = listPersonalAgents(options.baseDataDir, fsApi);
  const agent = agents.find((entry) => entry.slug === slug) ?? null;
  if (agent === null) {
    const known = agents.map((entry) => `${NAME_OPTION} ${entry.slug}`);
    const choices =
      known.length > 0 ? `; its personal Agents: ${known.join(", ")}` : "";
    return {
      ok: false,
      error: `No personal Agent named "${name}" is set up on this computer: run "node runner.mjs setup ${NAME_OPTION} ${slug}" (Windows: setup-runner.cmd ${NAME_OPTION} ${slug})${choices}`,
    };
  }
  const { projectKey } = options;
  if (
    projectKey !== null &&
    agent.projectKey !== null &&
    agent.projectKey !== projectKey
  ) {
    return {
      ok: false,
      error: `The personal Agent ${slug} belongs to project ${agent.projectKey}, not ${projectKey}: drop ${PROJECT_OPTION_NAME} or use ${PROJECT_OPTION_NAME} ${agent.projectKey}`,
    };
  }
  return { ok: true, agent };
}

function resolveByProject(
  baseDataDir: string,
  projectKey: string,
  fsApi: InstanceDirFs
): ResolvePersonalAgentResult {
  const candidates = agentsOfProject(
    listPersonalAgents(baseDataDir, fsApi),
    projectKey
  );
  if (candidates.length === 0) {
    return { ok: true, agent: null };
  }
  if (candidates.length === 1) {
    return { ok: true, agent: candidates[0] };
  }
  const choices = candidates
    .map((agent) => `${NAME_OPTION} ${agent.slug}`)
    .join(" or ");
  return {
    ok: false,
    error: `Several personal Agents of ${projectKey} are set up on this computer: add ${choices}`,
  };
}
