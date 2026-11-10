/**
 * @file headless-main.ts
 * @description Entry point of the headless runner bundle
 * (`dist-headless/runner.mjs`, built by scripts/build-headless-runner.mjs).
 * Reads the configuration, checks the machine, connects to AgentFlow, and
 * shuts down cleanly on SIGTERM/SIGINT. See docs/runner.md.
 *
 *   node runner.mjs                       the auto runner (one per computer)
 *   node runner.mjs --project <key> [--server <host>] [--role "<role>"]   the personal runner of a project
 *   node runner.mjs setup [--project <key> [--server <host>]]   asks the setup questions
 *   node runner.mjs uninstall [--project <key> [--server <host>]]   removes the Windows service, optionally the data
 *   node runner.mjs check --project <key> [--server <host>]   validates AGENTFLOW.md and exits
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
import { parseRunnerArgs, SETUP_COMMAND } from "./headless-args.js";
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
  RUNNER_DATA_DIR_ENV,
  RunnerMode,
  resolveRunnerDataDir,
} from "./headless-env.js";
import {
  defaultInstanceDirFs,
  personalAgentOptions,
  personalInstanceDir,
  personalSetupTarget,
  resolvePersonalInstance,
  SERVER_OPTION,
} from "./headless-instance-dir.js";
import { acquireInstanceLock } from "./headless-instance-lock.js";
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
  readRunnerConfigFile,
  runnerConfigFile,
  SETUP_SETTINGS,
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
  if (args.value.uninstall) {
    await runUninstallCommand(args.value.projectKey, args.value.server);
    return;
  }
  if (args.value.check) {
    runCheckCommand(args.value.projectKey, args.value.server);
    return;
  }
  if (args.value.setup) {
    await runInteractiveSetup(
      setupPrefillDir(args.value.projectKey, args.value.server),
      args.value.projectKey
    );
    return;
  }
  const instance = resolveInstance(args.value.projectKey, args.value.server);
  if (!instance.ok) {
    gatewayLog.error(LOG_TAG, instance.error);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  let { dataDir, server } = instance;
  if (args.value.role) {
    // The flag wins over the environment and runner.env.
    process.env[HeadlessRunnerEnv.RunnerRole] = args.value.role;
  }
  logServiceMode();
  applyRunnerConfig(
    process.env,
    readRunnerConfigFile(runnerConfigFile(dataDir))
  );
  if (needsSetup(process.env) && process.stdin.isTTY) {
    const setup = await runInteractiveSetup(dataDir, args.value.projectKey);
    dataDir = setup.dataDir;
    server = setup.server;
    if (setup.serviceStarted) {
      const files = serviceFiles({
        id: setup.serviceId,
        instanceDataDir: dataDir,
      });
      process.stdout.write(
        `The Agent now runs as the Windows service ${setup.serviceId}; this window can be closed. Logs: ${files.logDir}\n`
      );
      return;
    }
    applyRunnerConfig(
      process.env,
      readRunnerConfigFile(runnerConfigFile(dataDir))
    );
  }
  // The data directory of this instance: its config, identity and jobs.
  process.env[RUNNER_DATA_DIR_ENV] = dataDir;

  const config = loadInstanceConfig(dataDir, args.value.projectKey, server);
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
  const executables = isWindows()
    ? windowsToolOverrides(await prepareWindowsTools(config.dataDir))
    : {};
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
  const runner = await startHeadlessRunner(config, toCapabilities(report));
  installShutdownHandlers(runner);
}

/** `--project` starts the personal runner of that project, and nothing else. */
function checkInstanceMode(
  config: HeadlessRunnerConfig,
  projectKey: string | null,
  server: string | null
): string | null {
  if (!projectKey) {
    return null;
  }
  if (!config.personal) {
    const options = personalAgentOptions(projectKey, server);
    return `${options} starts a personal runner, but its configuration is not personal: run "node runner.mjs ${SETUP_COMMAND} ${options}"`;
  }
  return config.personal.projectKey === projectKey
    ? null
    : `${personalAgentOptions(projectKey, server)} does not match the configured project key ${config.personal.projectKey}`;
}

/**
 * The instance's configuration, once it is valid, matches `--project`, and
 * this process holds the data directory's lock; null (errors logged)
 * otherwise. Configures the personal runner's project.
 */
function loadInstanceConfig(
  dataDir: string,
  projectKey: string | null,
  server: string | null
): HeadlessRunnerConfig | null {
  const loaded = loadHeadlessConfig();
  if (!loaded.ok) {
    for (const error of loaded.errors) {
      gatewayLog.error(LOG_TAG, `Invalid configuration: ${error}`);
    }
    const setup = projectKey
      ? `${SETUP_COMMAND} ${personalAgentOptions(projectKey, server)}`
      : SETUP_COMMAND;
    gatewayLog.error(
      LOG_TAG,
      `Configure the runner with "node runner.mjs ${setup}" (saved to ${runnerConfigFile(dataDir)}) or environment variables (docs/runner.md).`
    );
    return null;
  }
  const { config } = loaded;
  const modeError = checkInstanceMode(config, projectKey, server);
  if (modeError) {
    gatewayLog.error(LOG_TAG, modeError);
    return null;
  }
  const instance = acquireInstanceLock(config.dataDir);
  if (!instance.ok) {
    gatewayLog.error(LOG_TAG, `Cannot start: ${instance.error}`);
    const installed = installedServiceId(config.dataDir);
    if (installed) {
      const keyOption = projectKey
        ? ` ${personalAgentOptions(projectKey, server)}`
        : "";
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
    const onServer = server ? ` on ${server}` : "";
    gatewayLog.info(
      LOG_TAG,
      `Personal runner of project ${config.personal.projectKey}${onServer}: loops run in ${config.personal.projectDir} with this computer's credentials, ${config.personal.parallel ? "several at once" : "one at a time"}${config.personal.role ? `, role ${config.personal.role}` : ""}`
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
 * for the auto runner, the project's own for a personal runner.
 * `serviceStarted` is true when the Agent now runs as a Windows service.
 */
async function runInteractiveSetup(
  dataDir: string,
  projectKey: string | null
): Promise<{
  dataDir: string;
  server: string | null;
  serviceId: string;
  serviceStarted: boolean;
}> {
  const { ask, say, close } = openPrompt();
  try {
    const fromFile = readRunnerConfigFile(runnerConfigFile(dataDir));
    const current: Record<string, string | undefined> = {};
    for (const name of SETUP_SETTINGS) {
      current[name] = process.env[name]?.trim() || fromFile[name];
    }
    say("AgentFlow runner setup. Press Enter to keep the value in brackets.");
    const context = {
      ask,
      say,
      current,
      username: currentUsername(),
      homeDir: os.homedir(),
    };
    const mode = projectKey
      ? RunnerMode.Personal
      : await askRunnerMode(context);
    const answers = await askRunnerSettings(context, mode);
    const answeredKey = answers[HeadlessRunnerEnv.ProjectKey];
    const target =
      mode === RunnerMode.Personal && answeredKey
        ? personalSetupTarget(
            {
              baseDataDir: resolveRunnerDataDir(),
              projectKey: answeredKey,
              apiUrl: answers[HeadlessRunnerEnv.ApiUrl] ?? "",
            },
            defaultInstanceDirFs()
          )
        : { dataDir: resolveRunnerDataDir(), projectKey: null, server: null };
    const targetDir = target.dataDir;
    const configFile = runnerConfigFile(targetDir);
    writeRunnerConfigFile(configFile, answers);
    say(`Saved to ${configFile}`);
    if (mode === RunnerMode.Personal && answeredKey) {
      const options = personalAgentOptions(answeredKey, target.server);
      say(
        `Start this personal runner with: start-runner ${options} (node runner.mjs ${options})`
      );
      if (target.server) {
        say(
          `${answeredKey} already has a personal Agent for another AgentFlow server here; this one is kept in ${targetDir} and needs ${SERVER_OPTION} ${target.server}.`
        );
      }
    }
    const serviceKey =
      mode === RunnerMode.Personal ? (answeredKey ?? null) : null;
    const serviceStarted = isWindows()
      ? await offerWindowsService(context, targetDir, serviceKey, target.server)
      : false;
    return {
      dataDir: targetDir,
      server: target.server,
      serviceId: serviceId(serviceKey, target.server),
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
  server: string | null
): Promise<boolean> {
  const programDir = path.dirname(fileURLToPath(import.meta.url));
  const spec = {
    id: serviceId(projectKey, server),
    instanceDataDir: instanceDir,
    projectKey,
    server,
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
      `The Agent runs as the Windows service ${spec.id} (${serviceDisplayName(projectKey, server)}) and starts with Windows. Logs: ${serviceFiles(spec).logDir}`
    );
  }
  return running;
}

/** `uninstall`: removes the Windows service and, when asked, the data. */
async function runUninstallCommand(
  projectKey: string | null,
  server: string | null
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
      { baseDataDir: resolveRunnerDataDir(), projectKey, server },
      defaultUninstallDeps(say, (question) =>
        askYesNo(context, question, false)
      )
    );
  } finally {
    close();
  }
}

/** `check --project <key>`: validates the project folder's AGENTFLOW.md, no network. */
function runCheckCommand(
  projectKey: string | null,
  server: string | null
): void {
  if (!projectKey) {
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const instance = resolveInstance(projectKey, server);
  if (!instance.ok) {
    gatewayLog.error(LOG_TAG, instance.error);
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  const { dataDir } = instance;
  const env = { ...process.env };
  applyRunnerConfig(env, readRunnerConfigFile(runnerConfigFile(dataDir)));
  const projectDir = env[HeadlessRunnerEnv.ProjectDir]?.trim();
  if (!projectDir) {
    gatewayLog.error(
      LOG_TAG,
      `No project folder configured for ${projectKey}: run node runner.mjs ${SETUP_COMMAND} ${personalAgentOptions(projectKey, server)}`
    );
    process.exitCode = EXIT_CONFIG_ERROR;
    return;
  }
  process.exitCode = runCapabilitiesCheck({
    projectKey,
    projectDir: path.resolve(projectDir),
    homeDir: os.homedir(),
    write: (line) => process.stdout.write(`${line}\n`),
  });
}

/** The data directory (and server) of the auto runner or of a personal Agent. */
function resolveInstance(
  projectKey: string | null,
  server: string | null
):
  | { ok: true; dataDir: string; server: string | null }
  | { ok: false; error: string } {
  if (!projectKey) {
    return { ok: true, dataDir: resolveRunnerDataDir(), server: null };
  }
  const resolved = resolvePersonalInstance(
    { baseDataDir: resolveRunnerDataDir(), projectKey, server },
    defaultInstanceDirFs()
  );
  if (!resolved.ok) {
    return resolved;
  }
  return {
    ok: true,
    dataDir: resolved.instance.dataDir,
    server: resolved.instance.server,
  };
}

/** The directory whose config the setup questions start from. */
function setupPrefillDir(
  projectKey: string | null,
  server: string | null
): string {
  if (!projectKey) {
    return resolveRunnerDataDir();
  }
  const instance = resolveInstance(projectKey, server);
  if (instance.ok) {
    return instance.dataDir;
  }
  return personalInstanceDir(resolveRunnerDataDir(), projectKey, server);
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
