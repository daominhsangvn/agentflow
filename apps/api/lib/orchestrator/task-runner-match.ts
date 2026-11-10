import { OrchestratorToolName } from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";

/**
 * The Agent a task_run runs on. The runner names an Agent by compute target id, machine name or
 * role. A case's tasks of one role stay on one Agent (its workspace holds the case's uncommitted
 * work): that Agent is derived from the case's started tasks. A name or role shared by several
 * Agents resolves to the case's Agent, else to the least-loaded online one; naming another Agent
 * of a role the case already works on is refused.
 */
export function pickCaseTaskRunner(
  files: ComputeTargetCapabilities[],
  runner: string,
  context: CaseRunnerContext
): Result<ComputeTargetCapabilities, string> {
  const matched = matchTaskRunners(files, runner);
  if (!matched.ok) {
    return matched;
  }
  const candidates = matched.value;
  if (candidates.length === 1) {
    return pickSingle(files, candidates[0], context);
  }
  return pickAmongSeveral(files, runner, candidates, context);
}

/** Candidates the runner names: by id (one), else by name, else by role; err when none. */
export function matchTaskRunners(
  files: ComputeTargetCapabilities[],
  runner: string
): Result<ComputeTargetCapabilities[], string> {
  const wanted = runner.trim().toLowerCase();
  const byId = files.find((file) => file.computeTargetId === runner.trim());
  if (byId) {
    return Result.ok([byId]);
  }
  const byName = files.filter(
    (file) => file.runnerName.toLowerCase() === wanted
  );
  if (byName.length > 0) {
    return Result.ok(byName);
  }
  const byRole = files.filter((file) => roleKey(file) === wanted);
  if (byRole.length > 0) {
    return Result.ok(byRole);
  }
  return Result.err(
    `No Agent "${runner}" of this project declared commands: ${files.map((file) => file.runnerName).join(", ") || "none did"}.`
  );
}

/** The case's Agent for a role (latest started task on a project Agent of that role), or null. */
export function caseAffinity(
  files: ComputeTargetCapabilities[],
  startedTargetIds: string[],
  role: string | null
): ComputeTargetCapabilities | null {
  const key = role?.trim().toLowerCase();
  if (!key) {
    return null;
  }
  for (const id of startedTargetIds) {
    const agent = files.find((file) => file.computeTargetId === id);
    if (agent && roleKey(agent) === key) {
      return agent;
    }
  }
  return null;
}

function pickSingle(
  files: ComputeTargetCapabilities[],
  candidate: ComputeTargetCapabilities,
  context: CaseRunnerContext
): Result<ComputeTargetCapabilities, string> {
  const affinity = affinityOf(files, candidate, context);
  if (affinity && affinity.computeTargetId !== candidate.computeTargetId) {
    return Result.err(affinityRefusal(affinity));
  }
  return Result.ok(candidate);
}

function pickAmongSeveral(
  files: ComputeTargetCapabilities[],
  runner: string,
  candidates: ComputeTargetCapabilities[],
  context: CaseRunnerContext
): Result<ComputeTargetCapabilities, string> {
  const own = candidates.filter(
    (candidate) =>
      affinityOf(files, candidate, context)?.computeTargetId ===
      candidate.computeTargetId
  );
  if (own.length > 0) {
    return Result.ok(earliestStarted(own, context.startedTargetIds));
  }
  const free = candidates.filter(
    (candidate) => affinityOf(files, candidate, context) === null
  );
  // No free candidate means every one has an affinity, so the first has one too.
  const elsewhere = affinityOf(files, candidates[0], context);
  if (free.length === 0 && elsewhere) {
    return Result.err(affinityRefusal(elsewhere));
  }
  return autoPick(runner, free, context.loads);
}

function affinityOf(
  files: ComputeTargetCapabilities[],
  candidate: ComputeTargetCapabilities,
  context: CaseRunnerContext
): ComputeTargetCapabilities | null {
  return caseAffinity(
    files,
    context.startedTargetIds,
    candidate.capabilities?.runner ?? null
  );
}

function earliestStarted(
  candidates: ComputeTargetCapabilities[],
  startedTargetIds: string[]
): ComputeTargetCapabilities {
  for (const id of startedTargetIds) {
    const hit = candidates.find(
      (candidate) => candidate.computeTargetId === id
    );
    if (hit) {
      return hit;
    }
  }
  return candidates[0];
}

function autoPick(
  runner: string,
  candidates: ComputeTargetCapabilities[],
  loads: Map<string, RunnerLoad>
): Result<ComputeTargetCapabilities, string> {
  const online = candidates.filter((candidate) => candidate.isOnline);
  if (online.length === 0) {
    const list = candidates
      .map((file) => `${file.runnerName} (${file.computeTargetId})`)
      .join(", ");
    return Result.err(
      `None of the Agents matching "${runner}" is online: ${list}. Run ${OrchestratorToolName.TaskRun} again when one is back.`
    );
  }
  const sorted = [...online].sort((a, b) => compareAgents(a, b, loads));
  return Result.ok(sorted[0]);
}

function compareAgents(
  a: ComputeTargetCapabilities,
  b: ComputeTargetCapabilities,
  loads: Map<string, RunnerLoad>
): number {
  const left = loadOf(loads, a.computeTargetId);
  const right = loadOf(loads, b.computeTargetId);
  const room = Number(hasRoom(right)) - Number(hasRoom(left));
  if (room !== 0) {
    return room;
  }
  return (
    ratio(left) - ratio(right) ||
    left.queued - right.queued ||
    a.runnerName.localeCompare(b.runnerName) ||
    a.computeTargetId.localeCompare(b.computeTargetId)
  );
}

function loadOf(loads: Map<string, RunnerLoad>, id: string): RunnerLoad {
  return loads.get(id) ?? { active: 0, queued: 0, capacity: 1 };
}

function hasRoom(load: RunnerLoad): boolean {
  return load.active + load.queued < load.capacity;
}

function ratio(load: RunnerLoad): number {
  return (load.active + load.queued) / Math.max(load.capacity, 1);
}

function roleKey(file: ComputeTargetCapabilities): string | null {
  return file.capabilities?.runner?.trim().toLowerCase() || null;
}

function affinityRefusal(affinity: ComputeTargetCapabilities): string {
  const role = affinity.capabilities?.runner?.trim() ?? "";
  return `This case's ${role} work runs on Agent ${affinity.runnerName} (${affinity.computeTargetId}): its workspace there holds the case's uncommitted changes. Run ${OrchestratorToolName.TaskRun} again with runner ${affinity.computeTargetId} (or the role "${role}"); a case's tasks of one role stay on one Agent, and wait for it when it is offline or busy.`;
}

export type RunnerLoad = { active: number; queued: number; capacity: number };

export type CaseRunnerContext = {
  /**
   * Agents holding the case: those of its started tasks (loopId set) and queued ones, latest
   * first, with the resumed task's Agent first; may repeat.
   */
  startedTargetIds: string[];
  /** Load per candidate Agent; missing = { active: 0, queued: 0, capacity: 1 }. */
  loads: Map<string, RunnerLoad>;
};
