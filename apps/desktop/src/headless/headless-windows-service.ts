/**
 * @file headless-windows-service.ts
 * @description Runs the Agent as a Windows service through WinSW (see
 * docs/runner.md, "Option D: Windows"). One service per Agent: the automatic
 * Agent and every personal Agent (project key, plus its server for a second server). Setup and uninstall ask for the
 * desired state; this module makes the service match it. Every process and
 * file operation goes through injected dependencies so the logic is testable
 * off Windows. Service control needs administrator rights, so SCM actions run
 * as a generated batch file behind one UAC prompt.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HeadlessRunnerEnv } from "./headless-env.js";
import { readRunnerStatus } from "./headless-status.js";

export const UAC_CANCELLED_EXIT_CODE = 1223;

export const ServiceState = {
  NonExistent: "NonExistent",
  Started: "Started",
  Stopped: "Stopped",
} as const;
export type ServiceState = (typeof ServiceState)[keyof typeof ServiceState];

export const ServiceOutcome = {
  Installed: "installed",
  Updated: "updated",
  Removed: "removed",
  Unchanged: "unchanged",
  Declined: "declined",
  Cancelled: "cancelled",
  Failed: "failed",
} as const;
export type ServiceOutcome =
  (typeof ServiceOutcome)[keyof typeof ServiceOutcome];

export type ServiceLocation = { id: string; instanceDataDir: string };

export type ServiceSpec = ServiceLocation & {
  projectKey: string | null;
  /** The `KEY@slug` server; null or absent for the legacy dir and the automatic Agent. */
  server?: string | null;
  nodePath: string;
  programDir: string;
  baseDataDir: string;
};

export type ProcessResult = { code: number; stdout: string; stderr: string };

export type WindowsServiceDeps = {
  /** Never rejects; a spawn error is code -1. */
  run(file: string, args: string[]): Promise<ProcessResult>;
  env: NodeJS.ProcessEnv;
  say(line: string): void;
  /** Enter = no. */
  confirm(question: string): Promise<boolean>;
  activeCommands(dataDir: string): number;
  fileSha256(file: string): string | null;
  exists(file: string): boolean;
  mkdir(dir: string): void;
  writeFile(file: string, content: string): void;
  copyFile(from: string, to: string): void;
  /** Ignores errors. */
  removeFile(file: string): void;
};

type ServiceFiles = {
  dir: string;
  exe: string;
  xml: string;
  logDir: string;
  elevatedScript: string;
};

const STATE_RE = /\b(NonExistent|Started|Stopped)\b/i;

export function serviceId(
  projectKey: string | null,
  server: string | null = null
): string {
  if (!projectKey) {
    return "agentflow-agent";
  }
  if (server) {
    return `agentflow-agent-${projectKey.toLowerCase()}-${server}`;
  }
  return `agentflow-agent-${projectKey.toLowerCase()}`;
}

export function serviceDisplayName(
  projectKey: string | null,
  server: string | null = null
): string {
  if (!projectKey) {
    return "AgentFlow Agent";
  }
  if (server) {
    return `AgentFlow Agent (${projectKey} @ ${server})`;
  }
  return `AgentFlow Agent (${projectKey})`;
}

export function serviceFiles(location: ServiceLocation): ServiceFiles {
  const dir = path.join(location.instanceDataDir, "service");
  return {
    dir,
    exe: path.join(dir, `${location.id}.exe`),
    xml: path.join(dir, `${location.id}.xml`),
    logDir: path.join(dir, "logs"),
    elevatedScript: path.join(dir, "elevated.cmd"),
  };
}

export function winswSourcePath(programDir: string): string {
  return path.join(programDir, "winsw", "WinSW.exe");
}

export function renderServiceXml(spec: ServiceSpec): string {
  const files = serviceFiles(spec);
  // No --role: the service reads the role (and the rest) from runner.env in
  // the instance data dir, which setup wrote.
  const runnerArgs = [`"${path.win32.join(spec.programDir, "runner.mjs")}"`];
  if (spec.projectKey) {
    runnerArgs.push("--project", spec.projectKey);
    if (spec.server) {
      runnerArgs.push("--server", spec.server);
    }
  }
  const lines = [
    "<service>",
    `  <id>${escapeXml(spec.id)}</id>`,
    `  <name>${escapeXml(serviceDisplayName(spec.projectKey, spec.server ?? null))}</name>`,
    "  <description>Runs AgentFlow agent loops on this computer (docs/runner.md).</description>",
    `  <executable>${escapeXml(spec.nodePath)}</executable>`,
    `  <arguments>${escapeXml(runnerArgs.join(" "))}</arguments>`,
    `  <workingdirectory>${escapeXml(spec.instanceDataDir)}</workingdirectory>`,
    `  <env name="${HeadlessRunnerEnv.DataDir}" value="${escapeXml(spec.baseDataDir)}"/>`,
    `  <env name="${HeadlessRunnerEnv.Service}" value="${escapeXml(spec.id)}"/>`,
    '  <env name="GIT_TERMINAL_PROMPT" value="0"/>',
    '  <env name="GCM_INTERACTIVE" value="never"/>',
    "  <startmode>Automatic</startmode>",
    "  <delayedAutoStart/>",
    '  <onfailure action="restart" delay="10 sec"/>',
    "  <resetfailure>1 hour</resetfailure>",
    "  <stoptimeout>30 sec</stoptimeout>",
    `  <logpath>${escapeXml(files.logDir)}</logpath>`,
    '  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>',
    "</service>",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function parseServiceState(stdout: string): ServiceState | null {
  const found = STATE_RE.exec(stdout);
  if (!found) {
    return null;
  }
  const word = found[1].toLowerCase();
  return (
    Object.values(ServiceState).find((s) => s.toLowerCase() === word) ?? null
  );
}

export function renderElevatedScript(
  title: string,
  commands: string[][],
  onFailure: string[][] = []
): string {
  const lines = ["@echo off", `echo AgentFlow: ${title}`];
  for (const command of commands) {
    lines.push(batchCommand(command), "if errorlevel 1 goto failed");
  }
  lines.push("exit /b 0", ":failed");
  for (const command of onFailure) {
    lines.push(batchCommand(command));
  }
  lines.push(
    "echo Failed. Press a key to close this window.",
    "pause >nul",
    "exit /b 1"
  );
  return `${lines.join("\r\n")}\r\n`;
}

export function elevationCommand(scriptFile: string): {
  file: "powershell.exe";
  args: string[];
} {
  const script = scriptFile.replaceAll("'", "''");
  const ps =
    `try { $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ""${script}""' ` +
    "-Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1223 }";
  return {
    file: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", ps],
  };
}

export function defaultWindowsServiceDeps(
  say: (line: string) => void,
  confirm: (question: string) => Promise<boolean>
): WindowsServiceDeps {
  return {
    run: runProcess,
    env: process.env,
    say,
    confirm,
    activeCommands: (dataDir) => readRunnerStatus(dataDir)?.activeCommands ?? 0,
    fileSha256: (file) => {
      try {
        return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      } catch {
        return null;
      }
    },
    exists: (file) => fs.existsSync(file),
    mkdir: (dir) => {
      fs.mkdirSync(dir, { recursive: true });
    },
    writeFile: (file, content) => {
      fs.writeFileSync(file, content);
    },
    copyFile: (from, to) => {
      fs.copyFileSync(from, to);
    },
    removeFile: (file) => {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // best effort
      }
    },
  };
}

export async function readServiceState(
  location: ServiceLocation,
  deps: WindowsServiceDeps
): Promise<ServiceState | null> {
  const { exe } = serviceFiles(location);
  if (!deps.exists(exe)) {
    return ServiceState.NonExistent;
  }
  const result = await deps.run(exe, ["status"]);
  return parseServiceState(result.stdout);
}

export async function runElevated(
  location: ServiceLocation,
  title: string,
  commands: string[][],
  deps: WindowsServiceDeps,
  onFailure: string[][] = []
): Promise<number> {
  const { elevatedScript, dir } = serviceFiles(location);
  deps.mkdir(dir);
  deps.writeFile(
    elevatedScript,
    renderElevatedScript(title, commands, onFailure)
  );
  const command = elevationCommand(elevatedScript);
  const result = await deps.run(command.file, command.args);
  deps.removeFile(elevatedScript);
  return result.code;
}

/** Makes the service match the wanted state (installed and running, or gone). */
export async function applyServiceChoice(
  spec: ServiceSpec,
  wanted: boolean,
  deps: WindowsServiceDeps
): Promise<ServiceOutcome> {
  const state = await readServiceState(spec, deps);
  if (state === null) {
    deps.say("Could not read the Windows service state (WinSW status failed).");
    return ServiceOutcome.Failed;
  }
  if (!wanted) {
    return state === ServiceState.NonExistent
      ? ServiceOutcome.Unchanged
      : removeService(spec, deps);
  }
  if (state === ServiceState.NonExistent) {
    return installService(spec, deps);
  }
  return updateService(spec, state, deps);
}

export async function removeService(
  location: ServiceLocation,
  deps: WindowsServiceDeps
): Promise<ServiceOutcome> {
  const state = await readServiceState(location, deps);
  if (state === ServiceState.NonExistent) {
    return ServiceOutcome.Unchanged;
  }
  if (state === null) {
    deps.say("Could not read the Windows service state (WinSW status failed).");
    return ServiceOutcome.Failed;
  }
  deps.say(`The Windows service ${location.id} is ${state}.`);
  const started = state === ServiceState.Started;
  if (started && !(await confirmActiveLoops(location, deps))) {
    deps.say("Left the Windows service as it is.");
    return ServiceOutcome.Declined;
  }
  const files = serviceFiles(location);
  const commands = started
    ? [
        [files.exe, "stop"],
        [files.exe, "uninstall"],
      ]
    : [[files.exe, "uninstall"]];
  const code = await runElevated(
    location,
    "remove the Agent service",
    commands,
    deps
  );
  if (code !== 0) {
    return failureOutcome(code, files.logDir, deps);
  }
  deps.removeFile(files.exe);
  deps.removeFile(files.xml);
  return ServiceOutcome.Removed;
}

export function installedServiceId(
  instanceDataDir: string,
  readdir: (dir: string) => string[] = fs.readdirSync
): string | null {
  try {
    const xml = readdir(path.join(instanceDataDir, "service")).find((name) =>
      name.toLowerCase().endsWith(".xml")
    );
    return xml ? xml.slice(0, -".xml".length) : null;
  } catch {
    return null;
  }
}

export function programFolderWarning(
  programDir: string,
  dirs: { homeDir: string; tmpDir: string }
): string | null {
  const program = programDir.toLowerCase();
  const risky = [path.join(dirs.homeDir, "Downloads"), dirs.tmpDir].map((dir) =>
    dir.toLowerCase()
  );
  if (!risky.some((dir) => program.startsWith(dir))) {
    return null;
  }
  return `The Agent program is in ${programDir}. Move the folder somewhere permanent and run setup-runner.cmd from there: the service runs runner.mjs from this folder.`;
}

async function installService(
  spec: ServiceSpec,
  deps: WindowsServiceDeps
): Promise<ServiceOutcome> {
  const files = serviceFiles(spec);
  const source = winswSourcePath(spec.programDir);
  if (!deps.exists(source)) {
    deps.say(
      String.raw`winsw\WinSW.exe is missing next to runner.mjs; use the release zip.`
    );
    return ServiceOutcome.Failed;
  }
  deps.mkdir(files.dir);
  deps.mkdir(files.logDir);
  deps.writeFile(files.xml, renderServiceXml(spec));
  deps.copyFile(source, files.exe);
  deps.removeFile(`${files.exe}:Zone.Identifier`);
  const account = `${deps.env.USERDOMAIN ?? ""}\\${deps.env.USERNAME ?? ""}`;
  deps.say(
    `WinSW asks for the Windows account that runs the Agent: enter ${account} and its password (not a Windows Hello PIN); answer y when it offers the log on as a service right.`
  );
  const code = await runElevated(
    spec,
    "install the Agent service",
    [
      [files.exe, "install", "/p"],
      [files.exe, "start"],
    ],
    deps,
    [[files.exe, "uninstall"]]
  );
  if (code !== 0) {
    // Leave no files that make a service that does not exist look installed.
    deps.removeFile(files.exe);
    deps.removeFile(files.xml);
    return failureOutcome(code, files.logDir, deps);
  }
  return ServiceOutcome.Installed;
}

async function updateService(
  spec: ServiceSpec,
  state: ServiceState,
  deps: WindowsServiceDeps
): Promise<ServiceOutcome> {
  const started = state === ServiceState.Started;
  if (started && !(await confirmActiveLoops(spec, deps))) {
    deps.say("Left the Windows service as it is.");
    return ServiceOutcome.Declined;
  }
  const files = serviceFiles(spec);
  const source = winswSourcePath(spec.programDir);
  deps.writeFile(files.xml, renderServiceXml(spec));
  let commands: string[][] = [[files.exe, started ? "restart" : "start"]];
  const sourceHash = deps.fileSha256(source);
  if (sourceHash !== null && sourceHash !== deps.fileSha256(files.exe)) {
    const staged = `${files.exe}.new`;
    deps.copyFile(source, staged);
    deps.removeFile(`${staged}:Zone.Identifier`);
    commands = [
      ...(started ? [[files.exe, "stop"]] : []),
      [BATCH_MOVE, "/y", staged, files.exe],
      [files.exe, "start"],
    ];
  }
  const code = await runElevated(
    spec,
    "update the Agent service",
    commands,
    deps
  );
  if (code !== 0) {
    return failureOutcome(code, files.logDir, deps);
  }
  return ServiceOutcome.Updated;
}

function failureOutcome(
  code: number,
  logDir: string,
  deps: WindowsServiceDeps
): ServiceOutcome {
  if (code === UAC_CANCELLED_EXIT_CODE) {
    deps.say(
      "Windows did not get administrator approval (UAC cancelled); nothing changed."
    );
    return ServiceOutcome.Cancelled;
  }
  deps.say(`The Windows service step failed (exit ${code}); logs: ${logDir}`);
  return ServiceOutcome.Failed;
}

function confirmActiveLoops(
  location: ServiceLocation,
  deps: WindowsServiceDeps
): Promise<boolean> {
  const n = deps.activeCommands(location.instanceDataDir);
  if (n === 0) {
    return Promise.resolve(true);
  }
  return deps.confirm(
    `Stopping the Agent fails ${n} loop(s) in AgentFlow. Continue? yes/no`
  );
}

function batchCommand(args: string[]): string {
  // cmd does not run a quoted internal command, so `move` stays bare.
  if (args[0] === BATCH_MOVE) {
    return `${BATCH_MOVE} ${args
      .slice(1)
      .map((arg) => (arg === "/y" ? arg : `"${arg.replaceAll("%", "%%")}"`))
      .join(" ")}`;
  }
  return args.map((arg) => `"${arg.replaceAll("%", "%%")}"`).join(" ");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function runProcess(file: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      let code = 0;
      if (error) {
        const errCode = (error as NodeJS.ErrnoException).code;
        code = typeof errCode === "number" ? errCode : -1;
      }
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** Marks a batch line that runs the cmd built-in `move` unquoted. */
const BATCH_MOVE = "move";
