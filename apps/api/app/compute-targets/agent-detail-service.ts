import {
  AGENT_RECENT_WORK_MAX,
  type AgentDetail,
  type AgentWorkflowUse,
} from "@repo/api/src/types/agent-fleet";
import { LoopStatus } from "@repo/api/src/types/loop";
import {
  ORCHESTRATOR_TASK_BLOCKED_PREFIX,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { ProjectStatus } from "@repo/api/src/types/project";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { withDb } from "@repo/database";
import { z } from "zod";
import {
  mergeRecentWork,
  toCapabilityFile,
  toHealthTools,
  usageWindow,
  type WindowCounts,
} from "@/app/compute-targets/agent-detail-mappers";
import {
  agentProjectIds,
  buildFleetEntry,
  FLEET_TARGET_SELECT,
  workflowRolesForTarget,
} from "@/app/compute-targets/fleet-service";
import { loadLoopUsage } from "@/lib/usage/loop-usage";
import { loadWindowedUsage } from "@/lib/usage/usage-windows";

/**
 * One agent's page: health tools, capability files, the projects and
 * workflows it serves, recent work and usage. Any org member may read any of
 * the organization's agents. Bounded queries, no per-item fan-out.
 */

const DAY_MS = 86_400_000;

export const agentDetailService = {
  /** Null when the organization has no such (non-sentinel) compute target. */
  async get(
    organizationId: string,
    targetId: string,
    now: Date = new Date()
  ): Promise<AgentDetail | null> {
    const target = await withDb((db) =>
      db.computeTarget.findFirst({
        where: { id: targetId, organizationId, isCloudSentinel: false },
        select: {
          ...FLEET_TARGET_SELECT,
          healthCheck: {
            select: {
              checkedAt: true,
              allRequiredPassed: true,
              requiredFailureIds: true,
              result: true,
            },
          },
        },
      })
    );
    if (!target) {
      return null;
    }
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const [
      capabilityRows,
      projects,
      workflows,
      tasks,
      loops,
      windowed,
      counts7,
      counts30,
    ] = await Promise.all([
      withDb((db) =>
        db.computeTargetCapabilities.findMany({
          where: { organizationId, computeTargetId: targetId },
          select: {
            computeTargetId: true,
            projectId: true,
            source: true,
            capabilities: true,
            problems: true,
            warnings: true,
            uploadedAt: true,
            project: { select: { id: true, name: true } },
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
          select: {
            id: true,
            name: true,
            projectId: true,
            agentConfig: true,
          },
        })
      ),
      withDb((db) =>
        db.orchestratorTask.findMany({
          where: { organizationId, computeTargetId: targetId },
          orderBy: { createdAt: "desc" },
          take: AGENT_RECENT_WORK_MAX,
          select: {
            id: true,
            command: true,
            status: true,
            result: true,
            loopId: true,
            createdAt: true,
            finishedAt: true,
            case: { select: { id: true, title: true } },
          },
        })
      ),
      withDb((db) =>
        db.loop.findMany({
          where: {
            organizationId,
            computeTargetId: targetId,
            workflowRunLoop: { isNot: null },
          },
          orderBy: { createdAt: "desc" },
          take: AGENT_RECENT_WORK_MAX,
          select: {
            id: true,
            command: true,
            status: true,
            createdAt: true,
            completedAt: true,
            workflowRunLoop: {
              select: {
                run: {
                  select: { id: true, workflowId: true, sourceKey: true },
                },
              },
            },
          },
        })
      ),
      loadWindowedUsage(organizationId, { now, computeTargetId: targetId }),
      loadWindowCounts(organizationId, targetId, since7),
      loadWindowCounts(organizationId, targetId, since30),
    ]);
    const loopIds = [
      ...tasks.flatMap((task) => (task.loopId === null ? [] : [task.loopId])),
      ...loops.map((loop) => loop.id),
    ];
    const usageByLoop = await loadLoopUsage(organizationId, loopIds, now);
    const agentProjects = agentProjectIds(targetId, projects, capabilityRows);
    return {
      agent: buildFleetEntry(target, capabilityRows, projects, workflows),
      healthTools: toHealthTools(target.healthCheck?.result),
      capabilities: capabilityRows.map(toCapabilityFile),
      projects: projects
        .filter((project) => agentProjects.has(project.id))
        .map((project) => ({ id: project.id, name: project.name })),
      workflows: toWorkflowUses(targetId, workflows, projects, agentProjects),
      recentWork: mergeRecentWork(tasks, loops, usageByLoop),
      usage: {
        last7d: usageWindow(counts7, windowed.last7d),
        last30d: usageWindow(counts30, windowed.last30d),
      },
    };
  },
};

function toWorkflowUses(
  targetId: string,
  workflows: {
    id: string;
    name: string;
    projectId: string | null;
    agentConfig: unknown;
  }[],
  projects: { id: string; name: string }[],
  agentProjects: Set<string>
): AgentWorkflowUse[] {
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name])
  );
  const uses: AgentWorkflowUse[] = [];
  for (const workflow of workflows) {
    const roles = workflowRolesForTarget(targetId, workflow, agentProjects);
    if (roles.length > 0 && workflow.projectId !== null) {
      uses.push({
        id: workflow.id,
        name: workflow.name,
        projectId: workflow.projectId,
        projectName: projectNames.get(workflow.projectId) ?? "",
        mode: readMode(workflow.agentConfig),
        roles,
      });
    }
  }
  return uses;
}

function readMode(agentConfig: unknown): WorkflowAgentMode {
  const parsed = modeSchema.safeParse(agentConfig);
  return parsed.success ? parsed.data.mode : WorkflowAgentMode.PlanAndExecute;
}

const modeSchema = z.object({ mode: z.enum(WorkflowAgentMode) });

async function loadWindowCounts(
  organizationId: string,
  computeTargetId: string,
  since: Date
): Promise<WindowCounts> {
  const [taskCounts, blocked, loopCounts] = await Promise.all([
    withDb((db) =>
      db.orchestratorTask.groupBy({
        by: ["status"],
        where: {
          organizationId,
          computeTargetId,
          finishedAt: { gte: since },
          status: {
            in: [
              OrchestratorTaskStatus.Succeeded,
              OrchestratorTaskStatus.Failed,
            ],
          },
        },
        _count: { _all: true },
      })
    ),
    withDb((db) =>
      db.orchestratorTask.count({
        where: {
          organizationId,
          computeTargetId,
          finishedAt: { gte: since },
          status: OrchestratorTaskStatus.Succeeded,
          result: {
            path: ["reply"],
            string_starts_with: ORCHESTRATOR_TASK_BLOCKED_PREFIX,
          },
        },
      })
    ),
    withDb((db) =>
      db.loop.groupBy({
        by: ["status"],
        where: {
          organizationId,
          computeTargetId,
          workflowRunLoop: { isNot: null },
          completedAt: { gte: since },
          status: {
            in: [LoopStatus.Completed, LoopStatus.Failed, LoopStatus.TimedOut],
          },
        },
        _count: { _all: true },
      })
    ),
  ]);
  return { taskCounts, blocked, loopCounts };
}
