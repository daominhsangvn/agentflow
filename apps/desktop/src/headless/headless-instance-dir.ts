/**
 * @file headless-instance-dir.ts
 * @description Which data directory a personal Agent uses. One per project
 * key and AgentFlow server: the first Agent of a key keeps `personal/<KEY>`,
 * a later Agent of the same key for another server gets `personal/<KEY>@<slug>`.
 * Pure helpers; file system reads are injected through InstanceDirFs.
 */

import fs from "node:fs";
import path from "node:path";

import { HeadlessRunnerEnv, PERSONAL_DATA_DIR_NAME } from "./headless-env.js";
import { readRunnerConfigFile, runnerConfigFile } from "./headless-setup.js";

export const SERVER_OPTION = "--server";
const PROJECT_OPTION_NAME = "--project";
const SERVER_SLUG_RE = /^[a-z0-9][a-z0-9.-]*$/;
const SERVER_SEPARATOR = "@";

export type InstanceDirFs = {
  exists(dir: string): boolean;
  /** Entry names of a directory; [] when it does not exist. */
  listDir(dir: string): string[];
  /** AGENTFLOW_API_URL of `<dir>/runner.env`, null when absent. */
  readApiUrl(dir: string): string | null;
};

export type PersonalInstance = {
  dataDir: string;
  projectKey: string;
  /** Non-null only for a `KEY@slug` dir: what must be passed as --server. */
  server: string | null;
};

export type PersonalInstanceResult =
  | { ok: true; instance: PersonalInstance }
  | { ok: false; error: string };

/** A short, file-name safe name of an AgentFlow server from its API URL. */
export function serverSlug(apiUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(apiUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname
    .toLowerCase()
    .replaceAll(/[[\]]/g, "")
    .replaceAll(":", "-");
  const slug = url.port ? `${host}-${url.port}` : host;
  return SERVER_SLUG_RE.test(slug) ? slug : null;
}

/** The slug of a --server value: a host, host:port, slug or full API URL. */
export function normalizeServerOption(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return serverSlug(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
}

export function personalInstanceDir(
  baseDataDir: string,
  projectKey: string,
  server: string | null
): string {
  const name = server
    ? `${projectKey}${SERVER_SEPARATOR}${server}`
    : projectKey;
  return path.join(baseDataDir, PERSONAL_DATA_DIR_NAME, name);
}

export function parsePersonalDirName(name: string): {
  projectKey: string;
  server: string | null;
} {
  const at = name.indexOf(SERVER_SEPARATOR);
  if (at < 0) {
    return { projectKey: name, server: null };
  }
  return { projectKey: name.slice(0, at), server: name.slice(at + 1) };
}

/** `--project K` plus ` --server S` when the Agent is keyed by server. */
export function personalAgentOptions(
  projectKey: string,
  server: string | null
): string {
  const project = `${PROJECT_OPTION_NAME} ${projectKey}`;
  return server ? `${project} ${SERVER_OPTION} ${server}` : project;
}

export function resolvePersonalInstance(
  options: { baseDataDir: string; projectKey: string; server: string | null },
  fsApi: InstanceDirFs
): PersonalInstanceResult {
  if (options.server) {
    return resolveWithServer(options, options.server, fsApi);
  }
  return resolveWithoutServer(options, fsApi);
}

/** Where setup stores an Agent that talks to apiUrl. */
export function personalSetupTarget(
  options: { baseDataDir: string; projectKey: string; apiUrl: string },
  fsApi: InstanceDirFs
): PersonalInstance {
  const { baseDataDir, projectKey } = options;
  const legacy = personalInstanceDir(baseDataDir, projectKey, null);
  const legacyInstance = { dataDir: legacy, projectKey, server: null };
  const slug = serverSlug(options.apiUrl);
  if (slug === null) {
    return legacyInstance;
  }
  const keyed = personalInstanceDir(baseDataDir, projectKey, slug);
  const keyedInstance = { dataDir: keyed, projectKey, server: slug };
  if (fsApi.exists(keyed)) {
    return keyedInstance;
  }
  const legacyUrl = fsApi.readApiUrl(legacy);
  if (legacyUrl === null || serverSlug(legacyUrl) === slug) {
    return legacyInstance;
  }
  return keyedInstance;
}

export function defaultInstanceDirFs(): InstanceDirFs {
  return {
    exists: (dir) => fs.existsSync(dir),
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    readApiUrl: (dir) => {
      try {
        const config = readRunnerConfigFile(runnerConfigFile(dir));
        return config[HeadlessRunnerEnv.ApiUrl]?.trim() || null;
      } catch {
        return null;
      }
    },
  };
}

function resolveWithServer(
  options: { baseDataDir: string; projectKey: string },
  server: string,
  fsApi: InstanceDirFs
): PersonalInstanceResult {
  const { baseDataDir, projectKey } = options;
  const keyed = personalInstanceDir(baseDataDir, projectKey, server);
  if (fsApi.exists(keyed)) {
    return { ok: true, instance: { dataDir: keyed, projectKey, server } };
  }
  const legacy = personalInstanceDir(baseDataDir, projectKey, null);
  if (
    fsApi.exists(legacy) &&
    serverSlug(fsApi.readApiUrl(legacy) ?? "") === server
  ) {
    return {
      ok: true,
      instance: { dataDir: legacy, projectKey, server: null },
    };
  }
  const command = personalAgentOptions(projectKey, server);
  return {
    ok: false,
    error: `No personal Agent of ${projectKey} for ${server} is set up on this computer: run "node runner.mjs setup ${command}" (Windows: setup-runner.cmd ${command})`,
  };
}

function resolveWithoutServer(
  options: { baseDataDir: string; projectKey: string },
  fsApi: InstanceDirFs
): PersonalInstanceResult {
  const { baseDataDir, projectKey } = options;
  const legacy = personalInstanceDir(baseDataDir, projectKey, null);
  const legacyInstance = { dataDir: legacy, projectKey, server: null };
  if (fsApi.exists(legacy)) {
    return { ok: true, instance: legacyInstance };
  }
  const prefix = `${projectKey}${SERVER_SEPARATOR}`;
  const servers = fsApi
    .listDir(path.join(baseDataDir, PERSONAL_DATA_DIR_NAME))
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length));
  if (servers.length === 0) {
    return { ok: true, instance: legacyInstance };
  }
  if (servers.length === 1) {
    const server = servers[0];
    const dataDir = personalInstanceDir(baseDataDir, projectKey, server);
    return { ok: true, instance: { dataDir, projectKey, server } };
  }
  const choices = servers
    .map((server) => `${SERVER_OPTION} ${server}`)
    .join(" or ");
  return {
    ok: false,
    error: `Several personal Agents of ${projectKey} are set up here, one per AgentFlow server: add ${choices}`,
  };
}
