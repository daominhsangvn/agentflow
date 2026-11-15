import type { Prisma } from "@repo/database";

/** A project row selected with `projectAgentIdsSelect`. */
export type ProjectAgentIdsRow = { agents: { computeTargetId: string }[] };

/** Selects a project's Agents (project_agents) in the order they were added. */
export const projectAgentIdsSelect = {
  agents: {
    select: { computeTargetId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ProjectSelect;

/** Ids of the project's Agents; empty when the project is missing or has none. */
export function projectAgentIds(
  project: ProjectAgentIdsRow | null | undefined
): string[] {
  return project?.agents.map((agent) => agent.computeTargetId) ?? [];
}
