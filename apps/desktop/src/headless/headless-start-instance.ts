/**
 * @file headless-start-instance.ts
 * @description Which Agent a start runs: the auto runner or a personal Agent,
 * from --name, --project or, without either, what is set up on this computer.
 */

import { gatewayLog } from "../main/logging/gateway-logger.js";
import { SETUP_COMMAND } from "./headless-args.js";
import { resolveRunnerDataDir } from "./headless-env.js";
import {
  agentNameSlug,
  agentsOfProject,
  chooseAgentToStart,
  defaultInstanceDirFs,
  findPersonalAgent,
  listPersonalAgents,
  type PersonalAgent,
  parseAgentChoice,
  personalAgentDir,
  resolvePersonalAgent,
} from "./headless-instance-dir.js";
import { isInstanceLockHeld } from "./headless-instance-lock.js";
import { openPrompt } from "./headless-prompt.js";
import { isRunnerConfigured } from "./headless-setup.js";

const LOG_TAG = "headless-runner";
/** The entry of the auto runner in the choice of a start without options. */
const AUTO_CHOICE_SLUG = "automatic-agent";

export type StartInstance =
  | { ok: true; dataDir: string | null; agentSlug: string | null }
  | { ok: false; error: string };

/**
 * The data directory (null: none yet, a terminal runs setup) and Agent slug
 * (null: the auto runner) a start uses.
 */
export async function resolveStartInstance(
  projectKey: string | null,
  name: string | null
): Promise<StartInstance> {
  const baseDataDir = resolveRunnerDataDir();
  if (name !== null) {
    return resolveNamedStart(baseDataDir, projectKey, name);
  }
  if (projectKey === null) {
    return await resolveBareStart(baseDataDir);
  }
  return await resolveKeyedStart(baseDataDir, projectKey);
}

/**
 * No option. Without a personal Agent here: the auto runner. Without a
 * configured auto runner (its runner.env or the environment): one of the
 * personal Agents, so a start right after a personal setup starts that Agent
 * and does not ask the auto runner's setup questions. With both, a terminal
 * chooses among those not running; a service or container keeps starting the
 * auto runner.
 */
async function resolveBareStart(baseDataDir: string): Promise<StartInstance> {
  const auto: StartInstance = {
    ok: true,
    dataDir: baseDataDir,
    agentSlug: null,
  };
  const agents = listPersonalAgents(baseDataDir, defaultInstanceDirFs());
  if (agents.length === 0) {
    return auto;
  }
  if (!isRunnerConfigured(baseDataDir, process.env)) {
    return await startAmongAgents(null, agents);
  }
  if (!process.stdin.isTTY) {
    return auto;
  }
  const free = [
    ...agents,
    {
      slug: AUTO_CHOICE_SLUG,
      projectKey: null,
      runnerName: "the automatic Agent",
      dataDir: baseDataDir,
    },
  ].filter((agent) => !isInstanceLockHeld(agent.dataDir));
  if (free.length === 0) {
    return {
      ok: false,
      error: "Every Agent set up on this computer is already running",
    };
  }
  const agent = free.length === 1 ? free[0] : await askAgentToStart(null, free);
  if (agent.dataDir === baseDataDir) {
    return auto;
  }
  gatewayLog.info(LOG_TAG, `Starting the personal Agent ${agent.slug}.`);
  return { ok: true, dataDir: agent.dataDir, agentSlug: agent.slug };
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
  return await startAmongAgents(projectKey, agents);
}

/** One of `agents` (a key's, or with a null key all of this computer's). */
async function startAmongAgents(
  projectKey: string | null,
  agents: PersonalAgent[]
): Promise<StartInstance> {
  const chosen = chooseAgentToStart(
    projectKey,
    agents,
    (dir) => isInstanceLockHeld(dir),
    Boolean(process.stdin.isTTY)
  );
  if (chosen.ok === false) {
    return chosen;
  }
  if (chosen.ok === "ask") {
    const agent = await askAgentToStart(projectKey, chosen.candidates);
    return { ok: true, dataDir: agent.dataDir, agentSlug: agent.slug };
  }
  const scope = projectKey ? ` of ${projectKey}` : "";
  if (chosen.picked) {
    gatewayLog.info(
      LOG_TAG,
      `Starting ${chosen.agent.slug}, the only personal Agent${scope} here that is not running (choose it next time with --name ${chosen.agent.slug}).`
    );
  } else if (projectKey === null) {
    gatewayLog.info(
      LOG_TAG,
      `Starting ${chosen.agent.slug}, the only personal Agent set up on this computer.`
    );
  }
  return {
    ok: true,
    dataDir: chosen.agent.dataDir,
    agentSlug: chosen.agent.slug,
  };
}

/** Asks which of several free Agents of a key starts; closes its prompt. */
async function askAgentToStart(
  projectKey: string | null,
  candidates: PersonalAgent[]
): Promise<PersonalAgent> {
  const { ask, say, close } = openPrompt();
  try {
    const owner = projectKey ?? "This computer";
    say(
      `${owner} has ${candidates.length} Agents${projectKey ? " on this computer" : ""} that are not running:`
    );
    candidates.forEach((agent, index) => {
      const project =
        projectKey === null && agent.projectKey ? `, ${agent.projectKey}` : "";
      say(
        `  ${index + 1}) ${agent.slug} (${agent.runnerName ?? agent.slug}${project})`
      );
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
