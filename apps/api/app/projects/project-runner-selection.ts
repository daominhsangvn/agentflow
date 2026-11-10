import { LoopStatus } from "@repo/api/src/types/loop";
import {
  readPersonalAgentProjectKey,
  readProjectRunnerIds,
} from "@repo/api/src/types/project-runners";
import { withDb } from "@repo/database";
import { z } from "zod";

/**
 * Which of a project's runners (Project → Repositories → Runners) a new loop
 * on one of its documents runs on. A project with runners only runs on them:
 * their toolchains match its repositories, so another computer is never
 * picked instead. The caller's own choice is kept when it is one of them;
 * otherwise the online non-personal runner with the most free capacity (loops waiting or
 * running against `maxInFlightCommands`) wins, the most recently seen among
 * equals. Any loop kind (PLAN or EXECUTE) comes here unless it continues a
 * parent loop (EXECUTE after PLAN): that one stays on the runner holding its
 * state.
 */

/** Loops a runner has accepted or is about to take. */
const ACTIVE_LOOP_STATUSES = [
  LoopStatus.Pending,
  LoopStatus.Claimed,
  LoopStatus.Running,
];

export const ProjectRunnerChoiceKind = {
  /** The document's project has no runners: choose as before. */
  None: "none",
  Resolved: "resolved",
  /** The project has runners, but none the caller can use is online. */
  Unavailable: "unavailable",
  /** The caller requires its named Agent and the project does not list it. */
  NotProjectAgent: "not_project_agent",
} as const;

export type ProjectRunnerChoice =
  | { kind: typeof ProjectRunnerChoiceKind.None }
  | { kind: typeof ProjectRunnerChoiceKind.Resolved; computeTargetId: string }
  | { kind: typeof ProjectRunnerChoiceKind.Unavailable; message: string }
  | { kind: typeof ProjectRunnerChoiceKind.NotProjectAgent; message: string };

export type ChooseProjectRunnerInput = {
  organizationId: string;
  userId: string;
  /** Computer the caller asked for; kept when it is one of the runners. */
  preferredComputeTargetId?: string | null;
  /**
   * A workflow's named Agent: refuse instead of choosing another Agent when
   * it is not a project Agent, or when it is a personal Agent that is
   * offline or not available to the caller.
   */
  requirePreferred?: boolean;
} & ProjectRunnerScope;

/**
 * Whose project's runners: a document's, or the project's own (a workflow run
 * before its documents exist).
 */
export type ProjectRunnerScope =
  | { documentId: string; projectId?: never }
  | { projectId: string; documentId?: never };

const capacitySchema = z.object({
  maxInFlightCommands: z.number().int().positive(),
});

export async function chooseProjectRunner(
  input: ChooseProjectRunnerInput
): Promise<ProjectRunnerChoice> {
  const { organizationId, userId } = input;
  const project = await readProject(organizationId, input);
  const runnerIds = readProjectRunnerIds(project?.settings);
  if (runnerIds.length === 0) {
    return { kind: ProjectRunnerChoiceKind.None };
  }
  const named =
    input.requirePreferred && input.preferredComputeTargetId
      ? await readNamedAgent(organizationId, input.preferredComputeTargetId)
      : null;
  if (named && !runnerIds.includes(named.id)) {
    return {
      kind: ProjectRunnerChoiceKind.NotProjectAgent,
      message: `Agent ${named.name} is not one of project ${project?.name ?? ""}'s Agents. Add it in Project → Agents, or change the workflow's Agent.`,
    };
  }
  const online = await withDb((db) =>
    db.computeTarget.findMany({
      where: {
        id: { in: runnerIds },
        organizationId,
        isCloudSentinel: false,
        isOnline: true,
        OR: [{ userId }, { isSharedWithOrg: true }],
      },
      select: { id: true, lastSeenAt: true, capabilities: true },
    })
  );
  if (online.length === 0) {
    return {
      kind: ProjectRunnerChoiceKind.Unavailable,
      message: named?.personal
        ? personalOfflineMessage(named.name)
        : "None of the project's runners is online and available to you. Start one, or change the project's runners.",
    };
  }
  const preferred = online.find(
    (target) => target.id === input.preferredComputeTargetId
  );
  if (named?.personal && !preferred) {
    return {
      kind: ProjectRunnerChoiceKind.Unavailable,
      message: personalOfflineMessage(named.name),
    };
  }
  if (preferred) {
    return {
      kind: ProjectRunnerChoiceKind.Resolved,
      computeTargetId: preferred.id,
    };
  }
  // A personal Agent runs in its owner's folder with their credentials, so a
  // step never moves there: it is used only when it is the named Agent.
  const shared = online.filter(
    (target) => readPersonalAgentProjectKey(target.capabilities) === null
  );
  if (shared.length === 0) {
    return {
      kind: ProjectRunnerChoiceKind.Unavailable,
      message:
        "None of the project's shared Agents is online and available to you. Start one, or change the project's Agents.",
    };
  }
  const active = await countActiveLoopsByTarget(
    organizationId,
    shared.map((target) => target.id)
  );
  const [best] = shared
    .map((target) => ({
      id: target.id,
      lastSeenAt: target.lastSeenAt.getTime(),
      load: (active.get(target.id) ?? 0) / capacityOf(target.capabilities),
    }))
    .sort((a, b) => a.load - b.load || b.lastSeenAt - a.lastSeenAt);
  return {
    kind: ProjectRunnerChoiceKind.Resolved,
    computeTargetId: best?.id ?? shared[0].id,
  };
}

/** Loops waiting for or running on each of `computeTargetIds`. */
export async function countActiveLoopsByTarget(
  organizationId: string,
  computeTargetIds: string[]
): Promise<Map<string, number>> {
  if (computeTargetIds.length === 0) {
    return new Map();
  }
  const groups = await withDb((db) =>
    db.loop.groupBy({
      by: ["computeTargetId"],
      where: {
        organizationId,
        computeTargetId: { in: computeTargetIds },
        status: { in: ACTIVE_LOOP_STATUSES },
      },
      _count: { _all: true },
    })
  );
  return new Map(
    groups.flatMap((group) =>
      group.computeTargetId
        ? [[group.computeTargetId, group._count._all] as const]
        : []
    )
  );
}

/** Loops a runner runs at once; 1 when it did not report it. */
export function capacityOf(capabilities: unknown): number {
  const parsed = capacitySchema.safeParse(capabilities);
  return parsed.success ? parsed.data.maxInFlightCommands : 1;
}

/** The project in scope: its name and settings (they list its Agents). */
async function readProject(
  organizationId: string,
  scope: ProjectRunnerScope
): Promise<{ name: string; settings: unknown } | null> {
  const { projectId } = scope;
  if (projectId !== undefined) {
    return await withDb((db) =>
      db.project.findFirst({
        where: { id: projectId, organizationId },
        select: { name: true, settings: true },
      })
    );
  }
  const document = await withDb((db) =>
    db.artifact.findFirst({
      where: { id: scope.documentId, organizationId },
      select: { project: { select: { name: true, settings: true } } },
    })
  );
  return document?.project ?? null;
}

/** The Agent a workflow names: display name and whether it is personal. */
async function readNamedAgent(
  organizationId: string,
  computeTargetId: string
): Promise<{ id: string; name: string; personal: boolean }> {
  const target = await withDb((db) =>
    db.computeTarget.findFirst({
      where: { id: computeTargetId, organizationId },
      select: { machineName: true, capabilities: true },
    })
  );
  return {
    id: computeTargetId,
    name: target?.machineName ?? computeTargetId,
    personal: readPersonalAgentProjectKey(target?.capabilities) !== null,
  };
}

/**
 * Ids of the Agents of the project in scope (settings.runnerIds); empty when
 * the project has none.
 */
export async function loadProjectRunnerIds(
  organizationId: string,
  scope: ProjectRunnerScope
): Promise<string[]> {
  const project = await readProject(organizationId, scope);
  return readProjectRunnerIds(project?.settings);
}

function personalOfflineMessage(name: string): string {
  return `Personal Agent ${name} is offline or not available to you. Start it, or change the workflow's Agent.`;
}
