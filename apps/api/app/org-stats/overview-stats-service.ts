import type {
  OrgProjectStats,
  OrgSessionStats,
  OrgWorkflowStats,
} from "@repo/api/src/types/org-stats";
import { ProjectStatus } from "@repo/api/src/types/project";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { withDb } from "@repo/database";

/** Cheap aggregates for the Home overview widgets. */

const DAY_MS = 86_400_000;

export const overviewStatsService = {
  async projects(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgProjectStats> {
    const since = daysAgo(now, 7);
    const [total, caseProjects, runProjects] = await Promise.all([
      withDb((db) =>
        db.project.count({
          where: { organizationId, status: { not: ProjectStatus.Archived } },
        })
      ),
      withDb((db) =>
        db.orchestratorCase.findMany({
          where: { organizationId, updatedAt: { gte: since } },
          distinct: ["projectId"],
          select: { projectId: true },
        })
      ),
      withDb((db) =>
        db.workflowRun.findMany({
          where: { organizationId, createdAt: { gte: since } },
          distinct: ["projectId"],
          select: { projectId: true },
        })
      ),
    ]);
    const candidateIds = [
      ...new Set([...caseProjects, ...runProjects].map((row) => row.projectId)),
    ];
    if (candidateIds.length === 0) {
      return { total, active7d: 0 };
    }
    const active = await withDb((db) =>
      db.project.findMany({
        where: {
          organizationId,
          id: { in: candidateIds },
          status: { not: ProjectStatus.Archived },
        },
        select: { id: true },
      })
    );
    return { total, active7d: active.length };
  },

  async workflows(organizationId: string): Promise<OrgWorkflowStats> {
    const [total, orchestrated, enabled] = await Promise.all([
      withDb((db) => db.workflow.count({ where: { organizationId } })),
      withDb((db) =>
        db.workflow.count({
          where: {
            organizationId,
            agentConfig: {
              path: ["mode"],
              equals: WorkflowAgentMode.Orchestrated,
            },
          },
        })
      ),
      withDb((db) =>
        db.workflow.count({ where: { organizationId, enabled: true } })
      ),
    ]);
    return {
      total,
      orchestrated,
      process: total - orchestrated,
      enabled,
      disabled: total - enabled,
    };
  },

  async sessions(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgSessionStats> {
    const countSince = (since: Date) =>
      withDb((db) =>
        db.sessionDetail.count({
          where: {
            artifact: { is: { organizationId } },
            sessionStartedAt: { gte: since },
          },
        })
      );
    const [last7d, last30d] = await Promise.all([
      countSince(daysAgo(now, 7)),
      countSince(daysAgo(now, 30)),
    ]);
    return { last7d, last30d };
  },
};

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
