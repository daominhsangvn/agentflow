import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type ProjectRunner,
  type ProjectRunners,
  readPersonalAgentProjectKey,
  readProjectRunnerIds,
  type UpdateProjectRunnersInput,
} from "@repo/api/src/types/project-runners";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { z } from "zod";
import { countActiveLoopsByTarget } from "./project-runner-selection";

/**
 * Agents of a project (Project → Repositories → Agents): the compute targets
 * its agent loops run on, stored as `runnerIds` in the project's `settings`
 * and written with a single jsonb update, so the other settings keys are kept.
 * Loops pick one through project-runner-selection.ts.
 */

export type ProjectRunnersServiceError = {
  status: StatusCode;
  message: string;
};

const capabilitiesSchema = z.object({
  maxInFlightCommands: z.number().int().positive().optional(),
  versions: z.record(z.string(), z.string()).optional(),
  toolchains: z.record(z.string(), z.string()).optional(),
});

const runnerSelect = {
  id: true,
  machineName: true,
  isOnline: true,
  isSharedWithOrg: true,
  capabilities: true,
  user: { select: { firstName: true, lastName: true } },
} as const;

export const projectRunnersService = {
  /** Null when the project does not exist in the organization. */
  async get(
    organizationId: string,
    projectId: string
  ): Promise<ProjectRunners | null> {
    const project = await findProject(organizationId, projectId);
    if (!project) {
      return null;
    }
    return buildProjectRunners(organizationId, project);
  },

  /**
   * Replaces the project's Agents. Each must be an Agent of the organization
   * the caller owns or that is shared with it; a personal Agent can only join
   * the project it registered for.
   */
  async update(
    organizationId: string,
    userId: string,
    projectId: string,
    input: UpdateProjectRunnersInput
  ): Promise<Result<ProjectRunners, ProjectRunnersServiceError>> {
    const project = await findProject(organizationId, projectId);
    if (!project) {
      return serviceError(Status.NotFound, "Project not found");
    }
    const runnerIds = [...new Set(input.runnerIds)];
    const refusal = await checkRequestedAgents({
      organizationId,
      userId,
      runnerIds,
      storedIds: readProjectRunnerIds(project.settings),
      projectKey: project.slug,
    });
    if (refusal) {
      return serviceError(Status.BadRequest, refusal);
    }
    const updated = await withDb(
      (db) =>
        db.$executeRaw`
        UPDATE projects
        SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{runnerIds}', ${JSON.stringify(runnerIds)}::jsonb),
            updated_at = NOW()
        WHERE id = ${projectId}::uuid AND organization_id = ${organizationId}::uuid`
    );
    if (updated === 0) {
      return serviceError(Status.NotFound, "Project not found");
    }
    return Result.ok(
      await buildProjectRunners(organizationId, {
        slug: project.slug,
        settings: { runnerIds },
      })
    );
  },
};

type ProjectRow = { slug: string | null; settings: unknown };

type RequestedAgents = {
  organizationId: string;
  userId: string;
  runnerIds: string[];
  storedIds: string[];
  projectKey: string | null;
};

type RunnerRow = {
  id: string;
  machineName: string;
  isOnline: boolean;
  isSharedWithOrg: boolean;
  capabilities: unknown;
  user: { firstName: string | null; lastName: string | null } | null;
};

function findProject(
  organizationId: string,
  projectId: string
): Promise<ProjectRow | null> {
  return withDb((db) =>
    db.project.findFirst({
      where: { id: projectId, organizationId },
      select: { settings: true, slug: true },
    })
  );
}

async function buildProjectRunners(
  organizationId: string,
  project: ProjectRow
): Promise<ProjectRunners> {
  const runnerIds = readProjectRunnerIds(project.settings);
  const [runners, waiting] = await Promise.all([
    loadRunners(organizationId, runnerIds),
    loadWaiting(organizationId, project.slug, runnerIds),
  ]);
  return { runners, projectKey: project.slug, waiting };
}

/** The reason the requested Agents cannot be saved; null when they can. */
async function checkRequestedAgents(
  request: RequestedAgents
): Promise<string | null> {
  const { organizationId, userId, runnerIds, storedIds, projectKey } = request;
  if (runnerIds.length === 0) {
    return null;
  }
  const targets = await withDb((db) =>
    db.computeTarget.findMany({
      where: { id: { in: runnerIds }, organizationId, isCloudSentinel: false },
      select: {
        id: true,
        machineName: true,
        userId: true,
        isSharedWithOrg: true,
        capabilities: true,
      },
    })
  );
  if (targets.length !== runnerIds.length) {
    return "Choose Agents of this organization";
  }
  for (const target of targets) {
    const key = readPersonalAgentProjectKey(target.capabilities);
    if (key && key !== projectKey && !storedIds.includes(target.id)) {
      return `${target.machineName} is a personal Agent of project ${key}: it can only be added to that project.`;
    }
    if (target.userId !== userId && !target.isSharedWithOrg) {
      return `${target.machineName} is not shared with the organization and you are not its owner. Ask its owner to share it with the organization, then add it.`;
    }
  }
  return null;
}

/** Personal Agents registered for the project that are not added yet. */
async function loadWaiting(
  organizationId: string,
  projectKey: string | null,
  runnerIds: string[]
): Promise<ProjectRunner[]> {
  if (!projectKey) {
    return [];
  }
  const targets = await withDb((db) =>
    db.computeTarget.findMany({
      where: {
        organizationId,
        isCloudSentinel: false,
        id: { notIn: runnerIds },
        capabilities: {
          path: ["personalRunner", "projectKey"],
          equals: projectKey,
        },
      },
      select: runnerSelect,
      orderBy: { machineName: "asc" },
    })
  );
  if (targets.length === 0) {
    return [];
  }
  const activeLoops = await countActiveLoopsByTarget(
    organizationId,
    targets.map((target) => target.id)
  );
  return targets.map((target) => toProjectRunner(target, activeLoops));
}

/** The runners in `runnerIds` order; computers deleted since are left out. */
async function loadRunners(
  organizationId: string,
  runnerIds: string[]
): Promise<ProjectRunner[]> {
  if (runnerIds.length === 0) {
    return [];
  }
  const [targets, activeLoops] = await Promise.all([
    withDb((db) =>
      db.computeTarget.findMany({
        where: { id: { in: runnerIds }, organizationId },
        select: runnerSelect,
      })
    ),
    countActiveLoopsByTarget(organizationId, runnerIds),
  ]);
  const byId = new Map(targets.map((target) => [target.id, target]));
  return runnerIds.flatMap((id) => {
    const target = byId.get(id);
    return target ? [toProjectRunner(target, activeLoops)] : [];
  });
}

function toProjectRunner(
  target: RunnerRow,
  activeLoops: Map<string, number>
): ProjectRunner {
  const capabilities = capabilitiesSchema.safeParse(target.capabilities);
  const ownerName = [target.user?.firstName, target.user?.lastName]
    .filter(Boolean)
    .join(" ");
  return {
    id: target.id,
    machineName: target.machineName,
    isOnline: target.isOnline,
    isSharedWithOrg: target.isSharedWithOrg,
    kind: readPersonalAgentProjectKey(target.capabilities)
      ? AgentKind.Personal
      : AgentKind.Automatic,
    ownerName: ownerName || null,
    capacity: capabilities.success
      ? (capabilities.data.maxInFlightCommands ?? null)
      : null,
    activeLoops: activeLoops.get(target.id) ?? 0,
    tools: capabilities.success
      ? { ...capabilities.data.versions, ...capabilities.data.toolchains }
      : {},
  };
}

function serviceError<T>(
  status: StatusCode,
  message: string
): Result<T, ProjectRunnersServiceError> {
  return Result.err({ status, message });
}
