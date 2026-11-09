import {
  type AgentFleetEntry,
  type AgentFleetProject,
  type AgentFleetResponse,
  AgentKind,
  AgentWorkflowRole,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import { ClaudeCodeVersionChannel } from "@repo/api/src/types/compute-target-model-provider";
import { ProjectStatus } from "@repo/api/src/types/project";
import { readProjectRunnerIds } from "@repo/api/src/types/project-runners";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { withDb } from "@repo/database";
import { z } from "zod";
import { readPinnedClaudeCodeVersion } from "@/app/compute-targets/model-provider-service";

/**
 * Agents fleet: every compute target of the organization (personal ones
 * included) with health, Claude Code version, the projects it serves and the
 * commands it declares. One query per table, no per-agent fan-out.
 */

export const FLEET_TARGET_SELECT = {
  id: true,
  machineName: true,
  isOnline: true,
  isSharedWithOrg: true,
  lastSeenAt: true,
  capabilities: true,
  modelProvider: true,
  user: { select: { firstName: true, lastName: true } },
  healthCheck: {
    select: {
      checkedAt: true,
      allRequiredPassed: true,
      requiredFailureIds: true,
    },
  },
} as const;

export type FleetTargetRow = {
  id: string;
  machineName: string;
  isOnline: boolean;
  isSharedWithOrg: boolean;
  lastSeenAt: Date;
  capabilities: unknown;
  modelProvider: unknown;
  user: { firstName: string | null; lastName: string | null } | null;
  healthCheck: {
    checkedAt: Date;
    allRequiredPassed: boolean;
    requiredFailureIds: unknown;
  } | null;
};

export type FleetCapabilityRow = {
  computeTargetId: string;
  projectId: string;
  capabilities: unknown;
  problems: unknown;
};

export type FleetProjectRow = { id: string; name: string; settings: unknown };

export type FleetWorkflowRow = {
  id: string;
  name: string;
  projectId: string | null;
  agentConfig: unknown;
};

export const computeTargetFleetService = {
  async list(organizationId: string): Promise<AgentFleetResponse> {
    const targets = await withDb((db) =>
      db.computeTarget.findMany({
        where: { organizationId, isCloudSentinel: false },
        select: FLEET_TARGET_SELECT,
        orderBy: { machineName: "asc" },
      })
    );
    if (targets.length === 0) {
      return { agents: [] };
    }
    const targetIds = targets.map((target) => target.id);
    const [capabilityRows, projects, workflows] = await Promise.all([
      withDb((db) =>
        db.computeTargetCapabilities.findMany({
          where: { organizationId, computeTargetId: { in: targetIds } },
          select: {
            computeTargetId: true,
            projectId: true,
            capabilities: true,
            problems: true,
          },
        })
      ),
      withDb((db) =>
        db.project.findMany({
          where: {
            organizationId,
            status: { not: ProjectStatus.Archived },
          },
          select: { id: true, name: true, settings: true },
        })
      ),
      withDb((db) =>
        db.workflow.findMany({
          where: { organizationId, enabled: true },
          select: { id: true, name: true, projectId: true, agentConfig: true },
        })
      ),
    ]);
    return {
      agents: targets.map((target) =>
        buildFleetEntry(target, capabilityRows, projects, workflows)
      ),
    };
  },
};

export function agentKind(capabilities: unknown): AgentKind {
  return personalRunnerSchema.safeParse(capabilities).success
    ? AgentKind.Personal
    : AgentKind.Automatic;
}

/** The semantic version in the reported `versions.claude` ("2.1.296 (Claude Code)"). */
export function reportedClaudeVersion(capabilities: unknown): string | null {
  const parsed = claudeVersionsSchema.safeParse(capabilities);
  if (!parsed.success) {
    return null;
  }
  return VERSION_PATTERN.exec(parsed.data.versions.claude)?.[0] ?? null;
}

export function compareClaudeCodeVersion(
  reported: string | null,
  pinned: string
): ClaudeCodeVersionStatus {
  if (pinned === ClaudeCodeVersionChannel.Latest) {
    return ClaudeCodeVersionStatus.Latest;
  }
  if (reported === null) {
    return ClaudeCodeVersionStatus.Unknown;
  }
  return reported === pinned
    ? ClaudeCodeVersionStatus.Match
    : ClaudeCodeVersionStatus.Mismatch;
}

export function ownerName(
  user: { firstName: string | null; lastName: string | null } | null
): string | null {
  const name = [user?.firstName, user?.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
  return name === "" ? null : name;
}

/** Projects that list the Agent (settings.runnerIds); AGENTFLOW.md only describes it. */
export function agentProjectIds(
  targetId: string,
  projects: { id: string; settings: unknown }[]
): Set<string> {
  const ids = new Set<string>();
  for (const project of projects) {
    if (readProjectRunnerIds(project.settings).includes(targetId)) {
      ids.add(project.id);
    }
  }
  return ids;
}

export function workflowRolesForTarget(
  targetId: string,
  workflow: { agentConfig: unknown; projectId: string | null },
  agentProjects: Set<string>
): AgentWorkflowRole[] {
  const config = agentConfigSchema.parse(workflow.agentConfig);
  const orchestrated = config.mode === WorkflowAgentMode.Orchestrated;
  const roles: AgentWorkflowRole[] = [];
  if (config.computeTargetId === targetId) {
    roles.push(
      orchestrated ? AgentWorkflowRole.Orchestrator : AgentWorkflowRole.Default
    );
  }
  if (config.runners.some((rule) => rule.computeTargetId === targetId)) {
    roles.push(AgentWorkflowRole.Rule);
  }
  if (
    orchestrated &&
    workflow.projectId !== null &&
    agentProjects.has(workflow.projectId)
  ) {
    roles.push(AgentWorkflowRole.ProjectAgent);
  }
  return roles;
}

export function buildFleetEntry(
  target: FleetTargetRow,
  capabilityRows: FleetCapabilityRow[],
  projects: FleetProjectRow[],
  workflows: FleetWorkflowRow[]
): AgentFleetEntry {
  const agentProjects = agentProjectIds(target.id, projects);
  const ownRows = capabilityRows.filter(
    (row) => row.computeTargetId === target.id
  );
  const fleetProjects: AgentFleetProject[] = projects
    .filter((project) => agentProjects.has(project.id))
    .map((project) => {
      const row = ownRows.find(
        (candidate) => candidate.projectId === project.id
      );
      return {
        id: project.id,
        name: project.name,
        commands: row ? declaredCommands(row.capabilities) : [],
        problemCount: row ? problemCount(row.problems) : 0,
      };
    });
  const reported = reportedClaudeVersion(target.capabilities);
  const pinned = readPinnedClaudeCodeVersion(target.modelProvider);
  return {
    id: target.id,
    machineName: target.machineName,
    displayName: displayNameFrom(ownRows),
    kind: agentKind(target.capabilities),
    ownerName: ownerName(target.user),
    isSharedWithOrg: target.isSharedWithOrg,
    isOnline: target.isOnline,
    lastSeen: target.lastSeenAt.toISOString(),
    health: target.healthCheck
      ? {
          healthChecked: target.healthCheck.checkedAt.toISOString(),
          allRequiredPassed: target.healthCheck.allRequiredPassed,
          requiredFailureCount: failureCount(
            target.healthCheck.requiredFailureIds
          ),
        }
      : null,
    claudeCode: {
      reported,
      pinned,
      status: compareClaudeCodeVersion(reported, pinned),
    },
    projects: fleetProjects,
    enabledWorkflowCount: workflows.filter(
      (workflow) =>
        workflowRolesForTarget(target.id, workflow, agentProjects).length > 0
    ).length,
  };
}

const personalRunnerSchema = z.object({ personalRunner: z.object({}) });
const claudeVersionsSchema = z.object({
  versions: z.object({ claude: z.string() }),
});
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
const agentConfigSchema = z
  .object({
    mode: z.string().optional(),
    computeTargetId: z.string().optional(),
    runners: z.array(z.object({ computeTargetId: z.string() })).catch([]),
  })
  .catch({ runners: [] });
const frontMatterSchema = z.object({
  runner: z.string().nullable().optional(),
  commands: z.array(z.object({ name: z.string() })).catch([]),
});
const unknownArraySchema = z.array(z.unknown()).catch([]);

function declaredCommands(capabilities: unknown): string[] {
  const parsed = frontMatterSchema.safeParse(capabilities);
  return parsed.success
    ? parsed.data.commands.map((command) => command.name)
    : [];
}

function displayNameFrom(rows: FleetCapabilityRow[]): string | null {
  for (const row of rows) {
    const parsed = frontMatterSchema.safeParse(row.capabilities);
    const runner = parsed.success ? parsed.data.runner?.trim() : undefined;
    if (runner) {
      return runner;
    }
  }
  return null;
}

function problemCount(problems: unknown): number {
  return unknownArraySchema.parse(problems).length;
}

function failureCount(requiredFailureIds: unknown): number {
  return unknownArraySchema.parse(requiredFailureIds).length;
}
