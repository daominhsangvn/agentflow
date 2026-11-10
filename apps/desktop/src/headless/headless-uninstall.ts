/**
 * @file headless-uninstall.ts
 * @description `node runner.mjs uninstall [--project <key> [--server <host>]]`: removes the
 * Agent's Windows service and, when asked, its local settings and data.
 * Kept apart from headless-main.ts so it can be unit tested with injected
 * dependencies. See docs/runner.md "Option D: Windows".
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWindows } from "../server/platform-shell.js";
import { PERSONAL_DATA_DIR_NAME } from "./headless-env.js";
import {
  defaultInstanceDirFs,
  type InstanceDirFs,
  parsePersonalDirName,
  personalAgentOptions,
  resolvePersonalInstance,
} from "./headless-instance-dir.js";
import { isInstanceLockHeld } from "./headless-instance-lock.js";
import {
  defaultWindowsServiceDeps,
  installedServiceId,
  removeService,
  type ServiceLocation,
  ServiceOutcome,
  serviceId,
} from "./headless-windows-service.js";

export type UninstallDeps = InstanceDirFs & {
  installedServiceId(dir: string): string | null;
  say(line: string): void;
  confirm(question: string): Promise<boolean>;
  isWindows: boolean;
  homeDir: string;
  removeService(location: ServiceLocation): Promise<ServiceOutcome>;
  isLockHeld(dir: string): boolean;
  /** Recursive, force. */
  removeDir(target: string): void;
};

/** Returns the process exit code. */
export async function runUninstall(
  options: {
    baseDataDir: string;
    projectKey: string | null;
    server?: string | null;
  },
  deps: UninstallDeps
): Promise<number> {
  const { baseDataDir, projectKey } = options;
  const target = uninstallTarget(options, deps);
  if ("error" in target) {
    deps.say(target.error);
    return 1;
  }
  const { dir, id } = target;
  if (deps.isWindows) {
    const outcome = await deps.removeService({
      id,
      instanceDataDir: dir,
    });
    if (
      outcome === ServiceOutcome.Declined ||
      outcome === ServiceOutcome.Cancelled ||
      outcome === ServiceOutcome.Failed
    ) {
      deps.say("Nothing else was changed.");
      return 1;
    }
  }
  const wantsDelete = await deps.confirm(
    `Delete this Agent's settings and data (${dir})? AgentFlow will see a new computer at the next setup. yes/no`
  );
  if (wantsDelete && !deleteInstanceData(dir, baseDataDir, projectKey, deps)) {
    return 1;
  }
  deps.say(
    "The Agent stays in AgentFlow as an offline computer; remove it there (Settings → Compute & Integrations) if you no longer need it. The program folder can be deleted once no Agent runs from it."
  );
  return 0;
}

export function defaultUninstallDeps(
  say: (line: string) => void,
  confirm: (question: string) => Promise<boolean>
): UninstallDeps {
  const serviceDeps = defaultWindowsServiceDeps(say, confirm);
  return {
    say,
    confirm,
    isWindows: isWindows(),
    homeDir: os.homedir(),
    removeService: (location) => removeService(location, serviceDeps),
    isLockHeld: (dir) => isInstanceLockHeld(dir),
    ...defaultInstanceDirFs(),
    installedServiceId: (dir) => installedServiceId(dir),
    removeDir: (target) => fs.rmSync(target, { recursive: true, force: true }),
  };
}

/** False (reason said) when the data was not deleted. */
function deleteInstanceData(
  dir: string,
  baseDataDir: string,
  projectKey: string | null,
  deps: UninstallDeps
): boolean {
  if (deps.isLockHeld(dir)) {
    deps.say(
      `Not deleted: an Agent process still uses ${dir}. Stop it and run uninstall again.`
    );
    return false;
  }
  if (projectKey) {
    deps.removeDir(dir);
    deps.say(`Deleted ${dir}`);
    return true;
  }
  if (
    dir === path.parse(dir).root ||
    path.resolve(dir) === path.resolve(deps.homeDir)
  ) {
    deps.say(
      `Not deleted: ${dir} is the filesystem root or your home directory, which is probably a wrong AGENTFLOW_RUNNER_DATA_DIR.`
    );
    return false;
  }
  for (const entry of deps.listDir(baseDataDir)) {
    if (entry !== PERSONAL_DATA_DIR_NAME) {
      deps.removeDir(path.join(baseDataDir, entry));
    }
  }
  deps.say(`Deleted the Agent data in ${dir}`);
  const remaining = deps.listDir(
    path.join(baseDataDir, PERSONAL_DATA_DIR_NAME)
  );
  if (remaining.length > 0) {
    const commands = remaining.map((name) => {
      const parsed = parsePersonalDirName(name);
      return `uninstall-runner.cmd ${personalAgentOptions(parsed.projectKey, parsed.server)}`;
    });
    deps.say(
      `Personal Agents still installed here; uninstall each with: ${commands.join(", ")}`
    );
  }
  return true;
}

function uninstallTarget(
  options: {
    baseDataDir: string;
    projectKey: string | null;
    server?: string | null;
  },
  deps: UninstallDeps
): { dir: string; id: string } | { error: string } {
  const { baseDataDir, projectKey } = options;
  if (!projectKey) {
    return { dir: baseDataDir, id: serviceId(null) };
  }
  const result = resolvePersonalInstance(
    { baseDataDir, projectKey, server: options.server ?? null },
    deps
  );
  if (!result.ok) {
    return { error: result.error };
  }
  const { instance } = result;
  return {
    dir: instance.dataDir,
    id:
      deps.installedServiceId(instance.dataDir) ??
      serviceId(projectKey, instance.server),
  };
}
