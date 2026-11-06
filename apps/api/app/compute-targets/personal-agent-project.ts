import { readPersonalAgentProjectKey } from "@repo/api/src/types/project-runners";
import { Result } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";

/**
 * A personal Agent's project key must name a project of the organization.
 * An automatic Agent (no project key) is always accepted.
 */
export async function checkPersonalAgentProject(
  organizationId: string,
  capabilities: unknown
): Promise<Result<null, string>> {
  const key = readPersonalAgentProjectKey(capabilities);
  if (!key) {
    return Result.ok(null);
  }
  const project = await withDb((db) =>
    db.project.findFirst({
      where: { organizationId, slug: key },
      select: { id: true },
    })
  );
  if (!project) {
    return Result.err(
      `Project ${key} is not in this organization. Set the personal Agent's project key (AGENTFLOW_RUNNER_PROJECT_KEY) to a project of the API key's organization.`
    );
  }
  return Result.ok(null);
}
