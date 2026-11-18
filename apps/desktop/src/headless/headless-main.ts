/**
 * @file headless-main.ts
 * @description Entry point of the headless runner bundle
 * (`dist-headless/runner.mjs`, built by scripts/build-headless-runner.mjs).
 * Reads the configuration, checks the machine, connects to AgentFlow, and
 * shuts down cleanly on SIGTERM/SIGINT. See docs/runner.md.
 *
 *   node runner.mjs                       the auto runner (one per computer)
 *   node runner.mjs [--project <key>] [--name <agent name>] [--role "<role>"]   a personal runner (an Agent of a project)
 *   node runner.mjs setup [--project <key>] [--name <agent name>]   asks the setup questions
 *   node runner.mjs uninstall [--project <key>] [--name <agent name>]   removes the Windows service, optionally the data
 *   node runner.mjs check [--project <key>] [--name <agent name>]   validates AGENTFLOW.md and exits
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { LoopHarness } from "@agentflow-ai/loops-api/desktop-request";
import { gatewayLog } from "../main/logging/gateway-logger.js";
import { ClaudeCredentialSource } from "../server/claude-credentials.js";
import { configureClaudeCodeVersionInstaller } from "../server/operations/claude-code-version-pin.js";
import { configurePersonalRunnerProject } from "../server/operations/personal-runner.js";
import { isWindows } from "../server/platform-shell.js";
import { createClaudeCodeVersionCheck } from "./claude-code-version-check.js";
import { createClaudeCodeVersions } from "./claude-code-versions.js";
import {
  parseRunnerArgs,
  type RunnerArgs,
  SETUP_COMMAND,
} from "./headless-args.js";
import {
  capabilitiesFileAllowsStart,
  runCapabilitiesCheck,
} from "./headless-capabilities-check.js";
import {
  type HeadlessRunnerConfig,
  loadHeadlessConfig,
} from "./headless-config.js";
import {
  HeadlessRunnerEnv,
  normalizeProjectKey,
  RUNNER_DATA_DIR_ENV,
  RunnerMode,
  resolveRunnerDataDir,
} from "./headless-env.js";
import {
  agentNameSlug,
  agentsOfProject,
  checkPersonalAgentName,
  chooseAgentToStart,
  defaultInstanceDirFs,
  findPersonalAgent,
  listPersonalAgents,
  type PersonalAgent,
  parseAgentChoice,
  personalAgentDir,
  personalAgentOptions,
  resolvePersonalAgent,
  setupNameDefault,
} from "./headless-instance-dir.js";
import {
  acquireInstanceLock,
  isInstanceLockHeld,
} from "./headless-instance-lock.js";
import {
  defaultPreflightDeps,
  fatalPreflightProblems,
  type PreflightReport,
  runHeadlessPreflight,
  toCapabilities,
} from "./headless-preflight.js";
import { type HeadlessRunner, startHeadlessRunner } from "./headless-runner.js";
import {
  type Ask,
  applyRunnerConfig,
  askRunnerMode,
  askRunnerSettings,
  askStartWithWindows,
  askYesNo,
  needsSetup,
  type PersonalAgentSetup,
  readRunnerConfigFile,
  runnerConfigFile,
  SETUP_SETTINGS,
  type SetupAnswers,
  type SetupContext,
  writeRunnerConfigFile,
} from "./headless-setup.js";
import { defaultUninstallDeps, runUninstall } from "./headless-uninstall.js";
import {
  applyServiceChoice,
  defaultWindowsServiceDeps,
  installedServiceId,
  programFolderWarning,
  readServiceState,
  ServiceOutcome,
  ServiceState,
  serviceDisplayName,
  serviceFiles,
  serviceId,
} from "./headless-windows-service.js";
import {
  prepareWindowsTools,
  windowsBinaryPaths,
  windowsToolOverrides,
} from "./headless-windows-tools.js";

const LOG_TAG = "headless-runner";
const EXIT_CONFIG_ERROR = 2;
const EXIT_PREFLIGHT_ERROR = 3;
const EXIT_RUNTIME_ERROR = 1;
const EXIT_INTERRUPTED = 130;
async function main(): Promise<void> {
  const args = parseRunnerArgs(process.argv.slice(2));
  if (!args.ok) {
    gatewayLog.error(LOG_TAG, args.error);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const { projectKey, name } = args.value;
  if (await runSubcommand(args.value)) {
    return;
  }
  const instance = await resolveStartInstance(projectKey, name);
  if (!instance.ok) {
    gatewayLog.error(LOG_TAG, instance.error);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const prepared = await prepareStartInstance(args.value, instance);
  if (prepared === null) {
    return;
  }
  const { dataDir, agentSlug } = prepared;
  // The data directory of this instance: its config, identity and jobs.
  process.env[RUNNER_DATA_DIR_ENV] = dataDir;

  const config = loadInstanceConfig(dataDir, projectKey, agentSlug);
  if (!config) {
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }

  if (
    config.personal &&
    !capabilitiesFileAllowsStart(
      config.personal.projectDir,
      {
        info: (m) => gatewayLog.info(LOG_TAG, m),
        error: (m) => gatewayLog.error(LOG_TAG, m),
      },
      config.personal.projectKey
    )
  ) {
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }

  // Before the preflight: it reads PATH, which then starts with the shims.
  const windowsTools = isWindows()
    ? await prepareWindowsTools(config.dataDir)
    : null;
  const executables = windowsTools ? windowsToolOverrides(windowsTools) : {};
  const report = await runHeadlessPreflight(
    config.workspaceDir,
    defaultPreflightDeps(executables)
  );
  logPreflight(report);
  const problems = fatalPreflightProblems(report);
  if (problems.length > 0) {
    for (const problem of problems) {
      gatewayLog.error(LOG_TAG, `Cannot start: ${problem}`);
    }
    process.exitCode = EXIT_PREFLIGHT_ERROR;
    return;
  }

  await setUpClaudeCode(config, report);
  const runner = await startHeadlessRunner(config, toCapabilities(report), {
    binaryPaths: windowsTools ? windowsBinaryPaths(windowsTools) : {},
  });
  installShutdownHandlers(runner);
}

/**
 * Applies the instance's runner.env and, from a terminal, runs setup when it
 * is missing. Null when the process must stop (a service took over, or there
 * is no Agent to start; the exit code is set).
 */
async function prepareStartInstance(
  args: RunnerArgs,
  instance: { dataDir: string | null; agentSlug: string | null }
): Promise<{ dataDir: string; agentSlug: string | null } | null> {
  const { projectKey, name } = args;
  let { dataDir, agentSlug } = instance;
  if (args.role) {
    // The flag wins over the environment and runner.env.
    process.env[HeadlessRunnerEnv.RunnerRole] = args.role;
  }
  logServiceMode();
  if (dataDir !== null) {
    applyRunnerConfig(
      process.env,
      readRunnerConfigFile(runnerConfigFile(dataDir))
    );
  }
  if ((dataDir === null || needsSetup(process.env)) && process.stdin.isTTY) {
    const setup = await runInteractiveSetup({
      prefillDir: dataDir,
      projectKey,
      agentName: name ?? agentSlug,
    });
    dataDir = setup.dataDir;
    agentSlug = setup.agentSlug;
    if (announceServiceStart(setup)) {
      return null;
    }
    applyRunnerConfig(
      process.env,
      readRunnerConfigFile(runnerConfigFile(dataDir))
    );
  }
  if (dataDir === null) {
    gatewayLog.error(
      LOG_TAG,
      `No personal Agent of ${projectKey} is set up on this computer: run "node runner.mjs ${SETUP_COMMAND} ${agentHint(projectKey, null)}"`
    );
    process.exitCode = EXIT_CONFIG_ERROR;
    return null;
  }
  return { dataDir, agentSlug };
}

/** Runs uninstall, check or setup when asked; true when one ran. */
async function runSubcommand(args: RunnerArgs): Promise<boolean> {
  const { projectKey, name } = args;
  if (args.uninstall) {
    await runUninstallCommand(projectKey, name);
    return true;
  }
  if (args.check) {
    runCheckCommand(projectKey, name);
    return true;
  }
  if (args.setup) {
    await runInteractiveSetup({
      prefillDir: setupPrefillDir(projectKey, name),
      projectKey,
      agentName: name,
    });
    return true;
  }
  return false;
}

/** True (and says so) when setup left the Agent running as a Windows service. */
function announceServiceStart(setup: {
  dataDir: string;
  serviceId: string;
  serviceStarted: boolean;
}): boolean {
  if (!setup.serviceStarted) {
    return false;
  }
  const files = serviceFiles({
    id: setup.serviceId,
    instanceDataDir: setup.dataDir,
  });
  process.stdout.write(
    `The Agent now runs as the Windows service ${setup.serviceId}; this window can be closed. Logs: ${files.logDir}
`
  );
  return true;
}

/** `--project` / `--name` start a personal runner, and nothing else. */
function checkInstanceMode(
  config: HeadlessRunnerConfig,
  projectKey: string | null,
  agentSlug: string | null
): string | null {
  if (projectKey) {
    return checkProjectMode(config, projectKey, agentSlug);
  }
  if (agentSlug && !config.personal) {
    return `--name ${agentSlug} starts a personal Agent, but its configuration is not personal: run "node runner.mjs ${SETUP_COMMAND} --name ${agentSlug}"`;
  }
  return null;
}

function checkProjectMode(
  config: HeadlessRunnerConfig,
  projectKey: string,
  agentSlug: string | null
): string | null {
  const options = personalAgentOptions(projectKey, agentSlug);
  if (!config.personal) {
    return `${options} starts a personal runner, but its configuration is not personal: run "node runner.mjs ${SETUP_COMMAND} ${options}"`;
  }
  return config.personal.projectKey === projectKey
    ? null
    : `${options} does not match the configured project key ${config.personal.projectKey}`;
}

/** The option naming an Agent in hints; "" for the automatic Agent. */
function agentHint(
  projectKey: string | null,
  agentSlug: string | null
): string {
  if (agentSlug) {
    return personalAgentOptions(projectKey ?? "", agentSlug);
  }
  return projectKey ? personalAgentOptions(projectKey, null) : "";
}

/**
 * The instance's configuration, once it is valid, matches `--project`, and
 * this process holds the data directory's lock; null (errors logged)
 * otherwise. Configures the personal runner's project.
 */
function loadInstanceConfig(
  dataDir: string,
  projectKey: string | null,
  agentSlug: string | null
): HeadlessRunnerConfig | null {
  const hint = agentHint(projectKey, agentSlug);
  const loaded = loadHeadlessConfig();
  if (!loaded.ok) {
    for (const error of loaded.errors) {
      gatewayLog.error(LOG_TAG, `Invalid configuration: ${error}`);
    }
    const setup = hint ? `${SETUP_COMMAND} ${hint}` : SETUP_COMMAND;
    gatewayLog.error(
      LOG_TAG,
      `Configure the runner with "node runner.mjs ${setup}" (saved to ${runnerConfigFile(dataDir)}) or environment variables (docs/runner.md).`
    );
    return null;
  }
  const { config } = loaded;
  const modeError = checkInstanceMode(config, projectKey, agentSlug);
  if (modeError) {
    gatewayLog.error(LOG_TAG, modeError);
    return null;
  }
  const instance = acquireInstanceLock(config.dataDir);
  if (!instance.ok) {
    gatewayLog.error(LOG_TAG, `Cannot start: ${instance.error}`);
    const installed = installedServiceId(config.dataDir);
    if (installed) {
      const keyOption = hint ? ` ${hint}` : "";
      gatewayLog.error(
        LOG_TAG,
        `This Agent is installed as the Windows service ${installed}. Stop it in services.msc, or remove it with uninstall-runner.cmd${keyOption}.`
      );
    }
    return null;
  }
  process.on("exit", () => instance.lock.release());
  if (config.personal) {
    configurePersonalRunnerProject(config.personal);
    const agentName = agentSlug ? ` ${agentSlug}` : "";
    gatewayLog.info(
      LOG_TAG,
      `Personal runner${agentName} of project ${config.personal.projectKey}: loops run in ${config.personal.projectDir} with this computer's credentials, ${config.personal.parallel ? "several at once" : "one at a time"}${config.personal.role ? `, role ${config.personal.role}` : ""}`
    );
  } else {
    fs.mkdirSync(config.workspaceDir, { recursive: true });
  }
  return config;
}

/** The Claude Code version set in AgentFlow, where the runner may pin one. */
async function setUpClaudeCode(
  config: HeadlessRunnerConfig,
  report: PreflightReport
): Promise<void> {
  if (config.personal) {
    // The person's own Claude Code: pinning repoints ~/.local/bin/claude,
    // which every runner and terminal of this account shares.
    gatewayLog.info(
      LOG_TAG,
      "Personal runner: loops run the claude on PATH (no version pinning); a loop fails when the provider pins another Claude Code version"
    );
    const claudePath = report.tools.find(
      (tool) => tool.name === LoopHarness.Claude
    )?.path;
    if (claudePath) {
      configureClaudeCodeVersionInstaller(
        createClaudeCodeVersionCheck({
          claudePath,
          homeDir: os.homedir(),
          log: { warn: (message) => gatewayLog.warn(LOG_TAG, message) },
        })
      );
    }
  } else if (isWindows()) {
    // Versions are installed as symlinked binaries, which Windows does not
    // allow an ordinary account to create.
    gatewayLog.info(
      LOG_TAG,
      "Claude Code version pinning is not supported on Windows; loops run the claude on PATH"
    );
  } else {
    await setUpClaudeCodeVersions(config.dataDir, report);
  }
}

/**
 * Asks the setup questions in this terminal and saves the answers to the
 * data directory of the chosen instance, which it returns: the default one
 * for the auto runner, the Agent's own (`personal/<agent slug>`) for a
 * personal runner. `serviceStarted` is true when the Agent now runs as a
 * Windows service.
 */
async function runInteractiveSetup(options: {
  prefillDir: string | null;
  projectKey: string | null;
  agentName: string | null;
}): Promise<{
  dataDir: string;
  agentSlug: string | null;
  serviceId: string;
  serviceStarted: boolean;
}> {
  const { prefillDir, projectKey, agentName } = options;
  const { ask, say, close } = openPrompt();
  try {
    const current = currentSettings(prefillDir);
    if (agentName) {
      current[HeadlessRunnerEnv.RunnerName] = setupNameDefault(
        agentName,
        current[HeadlessRunnerEnv.RunnerName]
      );
      if (projectKey) {
        current[HeadlessRunnerEnv.ProjectKey] = projectKey;
      }
    }
    say("AgentFlow runner setup. Press Enter to keep the value in brackets.");
    const context: SetupContext = {
      ask,
      say,
      current,
      username: currentUsername(),
      homeDir: os.homedir(),
      personalAgents: personalAgentSetup(),
    };
    const mode =
      projectKey || agentName
        ? RunnerMode.Personal
        : await askRunnerMode(context);
    const answers = await askRunnerSettings(context, mode);
    const personal =
      mode === RunnerMode.Personal ? personalSetupTarget(answers) : null;
    const targetDir = personal?.dataDir ?? resolveRunnerDataDir();
    const configFile = runnerConfigFile(targetDir);
    writeRunnerConfigFile(configFile, answers);
    say(`Saved to ${configFile}`);
    const agentSlug = personal?.slug ?? null;
    if (personal) {
      announcePersonalAgent(say, personal, answers);
    }
    const serviceStarted = isWindows()
      ? await offerWindowsService(
          context,
          targetDir,
          personal?.projectKey ?? null,
          agentSlug
        )
      : false;
    return {
      dataDir: targetDir,
      agentSlug,
      serviceId: installedServiceId(targetDir) ?? serviceId(agentSlug),
      serviceStarted,
    };
  } finally {
    close();
  }
}

/** A readline prompt on this terminal. */
function openPrompt(): {
  ask: Ask;
  say: (line: string) => void;
  close(): void;
} {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // Without a listener, Ctrl+C only pauses the prompt.
  prompt.on("SIGINT", () => {
    prompt.close();
    process.exit(EXIT_INTERRUPTED);
  });
  // Read through the iterator, not prompt.question(): it keeps lines that
  // arrive before their question (answers piped in) and ends on end of input.
  const lines = prompt[Symbol.asyncIterator]();
  return {
    ask: async (question: string, shownDefault?: string) => {
      process.stdout.write(
        shownDefault ? `${question} [${shownDefault}]: ` : `${question}: `
      );
      const line = await lines.next();
      if (line.done) {
        throw new Error("Setup input ended before every question was answered");
      }
      return line.value.trim();
    },
    say: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    close: () => prompt.close(),
  };
}

/**
 * Windows only: asks whether this Agent starts with Windows and installs,
 * updates or removes its service. True when the service now runs it.
 */
async function offerWindowsService(
  context: SetupContext,
  instanceDir: string,
  projectKey: string | null,
  agentSlug: string | null
): Promise<boolean> {
  const programDir = path.dirname(fileURLToPath(import.meta.url));
  const spec = {
    id: installedServiceId(instanceDir) ?? serviceId(agentSlug),
    instanceDataDir: instanceDir,
    projectKey,
    agentName: agentSlug,
    nodePath: process.execPath,
    programDir,
    baseDataDir: resolveRunnerDataDir(),
  };
  const deps = defaultWindowsServiceDeps(context.say, (question) =>
    askYesNo(context, question, false)
  );
  const state = await readServiceState(spec, deps);
  const wanted = await askStartWithWindows(
    context,
    state !== null && state !== ServiceState.NonExistent
  );
  if (wanted) {
    const warning = programFolderWarning(programDir, {
      homeDir: os.homedir(),
      tmpDir: os.tmpdir(),
    });
    if (warning) {
      context.say(warning);
    }
  }
  const outcome = await applyServiceChoice(spec, wanted, deps);
  const running =
    outcome === ServiceOutcome.Installed || outcome === ServiceOutcome.Updated;
  if (running) {
    context.say(
      `The Agent runs as the Windows service ${spec.id} (${serviceDisplayName(agentSlug)}) and starts with Windows. Logs: ${serviceFiles(spec).logDir}`
    );
  }
  return running;
}

/** `uninstall`: removes the Windows service and, when asked, the data. */
async function runUninstallCommand(
  projectKey: string | null,
  name: string | null
): Promise<void> {
  const { ask, say, close } = openPrompt();
  try {
    const context: SetupContext = {
      ask,
      say,
      current: {},
      username: currentUsername(),
      homeDir: os.homedir(),
    };
    process.exitCode = await runUninstall(
      { baseDataDir: resolveRunnerDataDir(), projectKey, agentName: name },
      defaultUninstallDeps(say, (question) =>
        askYesNo(context, question, false)
      )
    );
  } finally {
    close();
  }
}

/** `check`: validates a personal Agent's project folder AGENTFLOW.md, no network. */
function runCheckCommand(projectKey: string | null, name: string | null): void {
  if (!(projectKey || name)) {
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const resolved = resolvePersonalAgent(
    { baseDataDir: resolveRunnerDataDir(), projectKey, name },
    defaultInstanceDirFs()
  );
  if (!resolved.ok) {
    gatewayLog.error(LOG_TAG, resolved.error);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const { agent } = resolved;
  if (agent === null) {
    gatewayLog.error(
      LOG_TAG,
      `No personal Agent of ${projectKey} is set up on this computer: run "node runner.mjs ${SETUP_COMMAND} ${agentHint(projectKey, null)}"`
    );
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const env = { ...process.env };
  applyRunnerConfig(env, readRunnerConfigFile(runnerConfigFile(agent.dataDir)));
  const agentKey =
    agent.projectKey ??
    projectKey ??
    normalizeProjectKey(env[HeadlessRunnerEnv.ProjectKey] ?? "");
  const projectDir = env[HeadlessRunnerEnv.ProjectDir]?.trim();
  if (!(agentKey && projectDir)) {
    gatewayLog.error(
      LOG_TAG,
      `No project key or folder configured for ${agent.slug}: run node runner.mjs ${SETUP_COMMAND} ${personalAgentOptions(agentKey ?? "", agent.slug)}`
    );
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  process.exitCode = runCapabilitiesCheck({
    projectKey: agentKey,
    projectDir: path.resolve(projectDir),
    homeDir: os.homedir(),
    write: (line) => process.stdout.write(`${line}\n`),
  });
}

type StartInstance =
  | { ok: true; dataDir: string | null; agentSlug: string | null }
  | { ok: false; error: string };

/**
 * The data directory (null: none yet, a terminal runs setup) and Agent slug
 * (null: the auto runner) a start uses.
 */
async function resolveStartInstance(
  projectKey: string | null,
  name: string | null
): Promise<StartInstance> {
  const baseDataDir = resolveRunnerDataDir();
  if (name !== null) {
    return resolveNamedStart(baseDataDir, projectKey, name);
  }
  if (projectKey === null) {
    return { ok: true, dataDir: baseDataDir, agentSlug: null };
  }
  return await resolveKeyedStart(baseDataDir, projectKey);
}

/** `--name`: that Agent's directory, even when it is not set up yet. */
function resolveNamedStart(
  baseDataDir: string,
  projectKey: string | null,
  name: string
): StartInstance {
  const slug = agentNameSlug(name);
  if (slug === null) {
    return {
      ok: false,
      error: `--name needs an agent name with a letter or digit, got "${name}"`,
    };
  }
  const fsApi = defaultInstanceDirFs();
  if (findPersonalAgent(baseDataDir, slug, fsApi) === null) {
    return {
      ok: true,
      dataDir: personalAgentDir(baseDataDir, slug),
      agentSlug: slug,
    };
  }
  const resolved = resolvePersonalAgent(
    { baseDataDir, projectKey, name },
    fsApi
  );
  if (!resolved.ok) {
    return resolved;
  }
  return {
    ok: true,
    dataDir: resolved.agent?.dataDir ?? null,
    agentSlug: slug,
  };
}

/** `--project` alone: the key's one Agent, or a choice among several. */
async function resolveKeyedStart(
  baseDataDir: string,
  projectKey: string
): Promise<StartInstance> {
  const interactive = Boolean(process.stdin.isTTY);
  const agents = agentsOfProject(
    listPersonalAgents(baseDataDir, defaultInstanceDirFs()),
    projectKey
  );
  if (agents.length === 0) {
    if (interactive) {
      return { ok: true, dataDir: null, agentSlug: null };
    }
    return {
      ok: false,
      error: `No personal Agent of ${projectKey} is set up on this computer: run "node runner.mjs ${SETUP_COMMAND} --project ${projectKey}", or start with --name <agent name> when its settings come from the environment`,
    };
  }
  const chosen = chooseAgentToStart(
    projectKey,
    agents,
    (dir) => isInstanceLockHeld(dir),
    interactive
  );
  if (chosen.ok === false) {
    return chosen;
  }
  if (chosen.ok === "ask") {
    const agent = await askAgentToStart(projectKey, chosen.candidates);
    return { ok: true, dataDir: agent.dataDir, agentSlug: agent.slug };
  }
  if (chosen.picked) {
    gatewayLog.info(
      LOG_TAG,
      `Starting ${chosen.agent.slug}, the only personal Agent of ${projectKey} here that is not running (choose it next time with --name ${chosen.agent.slug}).`
    );
  }
  return {
    ok: true,
    dataDir: chosen.agent.dataDir,
    agentSlug: chosen.agent.slug,
  };
}

/** The directory whose config the setup questions start from; null: none. */
function setupPrefillDir(
  projectKey: string | null,
  name: string | null
): string | null {
  const baseDataDir = resolveRunnerDataDir();
  const fsApi = defaultInstanceDirFs();
  const slug = name === null ? null : agentNameSlug(name);
  const named =
    slug === null ? null : findPersonalAgent(baseDataDir, slug, fsApi);
  if (named) {
    return named.dataDir;
  }
  if (projectKey) {
    const agents = listPersonalAgents(baseDataDir, fsApi);
    return agentsOfProject(agents, projectKey)[0]?.dataDir ?? null;
  }
  return name === null ? baseDataDir : null;
}

/** The setup settings: the environment first, then the directory's runner.env. */
function currentSettings(
  dataDir: string | null
): Record<string, string | undefined> {
  const fromFile = dataDir
    ? readRunnerConfigFile(runnerConfigFile(dataDir))
    : {};
  const current: Record<string, string | undefined> = {};
  for (const name of SETUP_SETTINGS) {
    current[name] = process.env[name]?.trim() || fromFile[name];
  }
  return current;
}

/** What setup knows of the personal Agents of this computer. */
function personalAgentSetup(): PersonalAgentSetup {
  const baseDataDir = resolveRunnerDataDir();
  const fsApi = defaultInstanceDirFs();
  return {
    list: (projectKey) =>
      agentsOfProject(listPersonalAgents(baseDataDir, fsApi), projectKey).map(
        (agent) => agent.slug
      ),
    checkName: (projectKey, name) =>
      checkPersonalAgentName(baseDataDir, projectKey, name, fsApi),
    load: (name) => {
      const slug = agentNameSlug(name);
      const agent = slug ? findPersonalAgent(baseDataDir, slug, fsApi) : null;
      return agent ? currentSettings(agent.dataDir) : null;
    },
  };
}

type PersonalSetupTarget = {
  projectKey: string;
  slug: string;
  dataDir: string;
  /** The Agents of the key before this setup wrote anything. */
  before: PersonalAgent[];
};

/** Where setup saves a personal Agent: its folder by the answered name. */
function personalSetupTarget(answers: SetupAnswers): PersonalSetupTarget {
  const projectKey = answers[HeadlessRunnerEnv.ProjectKey];
  const slug = agentNameSlug(answers[HeadlessRunnerEnv.RunnerName] ?? "");
  if (!(projectKey && slug)) {
    throw new Error("Personal setup answered no project key or Agent name");
  }
  const baseDataDir = resolveRunnerDataDir();
  const before = agentsOfProject(
    listPersonalAgents(baseDataDir, defaultInstanceDirFs()),
    projectKey
  );
  return {
    projectKey,
    slug,
    dataDir: personalAgentDir(baseDataDir, slug),
    before,
  };
}

/** Says whether the Agent was re-configured or added, and how to start it. */
function announcePersonalAgent(
  say: (line: string) => void,
  target: PersonalSetupTarget,
  answers: SetupAnswers
): void {
  const { projectKey, slug, dataDir, before } = target;
  const name = answers[HeadlessRunnerEnv.RunnerName] ?? slug;
  let total = before.length;
  if (before.some((agent) => agent.slug === slug)) {
    say(
      `Re-configured the personal Agent ${name} of ${projectKey} (${dataDir}).`
    );
  } else {
    total += 1;
    if (before.length > 0) {
      say(
        `Added another personal Agent of ${projectKey}: ${name}, kept in ${dataDir}. ${projectKey} now has ${total} personal Agents on this computer.`
      );
    }
  }
  let options = personalAgentOptions(projectKey, null);
  if (total > 1) {
    options = personalAgentOptions(projectKey, slug);
  }
  say(
    `Start this personal runner with: start-runner ${options} (node runner.mjs ${options})`
  );
}

/** Asks which of several free Agents of a key starts; closes its prompt. */
async function askAgentToStart(
  projectKey: string,
  candidates: PersonalAgent[]
): Promise<PersonalAgent> {
  const { ask, say, close } = openPrompt();
  try {
    say(
      `${projectKey} has ${candidates.length} personal Agents on this computer that are not running:`
    );
    candidates.forEach((agent, index) => {
      say(`  ${index + 1}) ${agent.slug} (${agent.runnerName ?? agent.slug})`);
    });
    for (;;) {
      const answer = await ask(`Which one starts? 1-${candidates.length}`);
      const agent = parseAgentChoice(answer, candidates);
      if (agent) {
        return agent;
      }
      say(`  answer a number from 1 to ${candidates.length}`);
    }
  } finally {
    close();
  }
}

/** Notes in the log that this process is the Windows service. */
function logServiceMode(): void {
  const id = process.env[HeadlessRunnerEnv.Service]?.trim();
  if (id) {
    gatewayLog.info(LOG_TAG, `Running as the Windows service ${id}`);
  }
}

function currentUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    // observability: probe — falls back to environment variables for the username
    return process.env.USERNAME ?? process.env.USER ?? "";
  }
}

function logPreflight(report: PreflightReport): void {
  for (const tool of report.tools) {
    gatewayLog.info(
      LOG_TAG,
      tool.path
        ? `${tool.name}: ${tool.version ?? "version unknown"} (${tool.path})`
        : `${tool.name}: not found`
    );
  }
  gatewayLog.info(LOG_TAG, `plugins: ${report.pluginsDir ?? "not found"}`);
  gatewayLog.info(LOG_TAG, `Claude credentials: ${report.claudeCredentials}`);
  if (report.claudeCredentials === ClaudeCredentialSource.None) {
    gatewayLog.warn(
      LOG_TAG,
      "No Claude credentials on this runner. Set a model provider for this computer in AgentFlow (Settings → Compute & Integrations → Model provider), or CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY here."
    );
  }
  for (const tool of report.missingRecommended) {
    gatewayLog.warn(
      LOG_TAG,
      `${tool} not found; loops cannot open pull requests`
    );
  }
}

function installShutdownHandlers(runner: HeadlessRunner): void {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) {
      return;
    }
    stopping = true;
    gatewayLog.info(LOG_TAG, `Received ${signal}, stopping`);
    runner.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        gatewayLog.error(LOG_TAG, `Shutdown failed: ${String(error)}`);
        process.exit(EXIT_RUNTIME_ERROR);
      }
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/**
 * Loops install and run the Claude Code version set for this computer in
 * AgentFlow; after a restart `claude` points at the last one again (a
 * recreated container loses ~/.local/bin, not the versions volume).
 */
async function setUpClaudeCodeVersions(
  dataDir: string,
  report: PreflightReport
): Promise<void> {
  const claudePath = report.tools.find(
    (tool) => tool.name === LoopHarness.Claude
  )?.path;
  if (!claudePath) {
    return;
  }
  const versions = createClaudeCodeVersions({
    homeDir: os.homedir(),
    dataDir,
    // The binary itself, not ~/.local/bin/claude, which each version change
    // repoints.
    installerPath: realpathOrSelf(claudePath),
    log: {
      info: (message) => gatewayLog.info(LOG_TAG, message),
      warn: (message) => gatewayLog.warn(LOG_TAG, message),
    },
  });
  try {
    const restored = await versions.restore();
    if (restored) {
      gatewayLog.info(
        LOG_TAG,
        `Claude Code ${restored.version} (set in AgentFlow): ${restored.binaryPath}`
      );
    }
  } catch (error) {
    gatewayLog.warn(
      LOG_TAG,
      `Could not restore the Claude Code version set in AgentFlow: ${String(error)}`
    );
  }
  configureClaudeCodeVersionInstaller(versions);
}

function realpathOrSelf(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    // observability: probe — falls back to the unresolved path
    return file;
  }
}

main().catch((error: unknown) => {
  gatewayLog.error(
    LOG_TAG,
    `Runner crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
  );
  process.exit(EXIT_RUNTIME_ERROR);
});
