import { OrchestratorToolName } from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";

/**
 * The Agent a task_run names: its compute target id first, then its machine name, then its role.
 * A name or role shared by several Agents is refused, so a task never lands on the wrong machine.
 */
export function matchTaskRunner(
  files: ComputeTargetCapabilities[],
  runner: string
): Result<ComputeTargetCapabilities, string> {
  const wanted = runner.trim().toLowerCase();
  const byId = files.find((file) => file.computeTargetId === runner.trim());
  if (byId) {
    return Result.ok(byId);
  }
  const byName = files.filter(
    (file) => file.runnerName.toLowerCase() === wanted
  );
  if (byName.length > 0) {
    return single(byName, runner, RunnerMatchBy.Name);
  }
  const byRole = files.filter(
    (file) => file.capabilities?.runner?.toLowerCase() === wanted
  );
  if (byRole.length > 0) {
    return single(byRole, runner, RunnerMatchBy.Role);
  }
  return Result.err(
    `No Agent "${runner}" of this project declared commands: ${files.map((file) => file.runnerName).join(", ") || "none did"}.`
  );
}

function single(
  matches: ComputeTargetCapabilities[],
  runner: string,
  by: RunnerMatchBy
): Result<ComputeTargetCapabilities, string> {
  if (matches.length === 1) {
    return Result.ok(matches[0]);
  }
  const list = matches
    .map((file) => `${file.runnerName} (${file.computeTargetId})`)
    .join(", ");
  return Result.err(
    `Several Agents of this project match "${runner}" by ${by}: ${list}. Run ${OrchestratorToolName.TaskRun} again with runner set to one Agent's id.`
  );
}

const RunnerMatchBy = { Name: "name", Role: "role" } as const;
type RunnerMatchBy = (typeof RunnerMatchBy)[keyof typeof RunnerMatchBy];
