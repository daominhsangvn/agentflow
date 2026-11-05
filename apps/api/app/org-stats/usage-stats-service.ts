import type {
  OrgUsageStats,
  OrgUsageTotals,
} from "@repo/api/src/types/org-stats";
import { withDb } from "@repo/database";
import { loadCaseStats } from "@/app/orchestrator/cases/service/case-stats";
import { sumByKey, topRows } from "@/app/org-stats/usage-top";
import {
  addUsage,
  emptyUsage,
  loadLoopUsage,
  type UsageTotals,
} from "@/lib/usage/loop-usage";
import { loadWindowedUsage } from "@/lib/usage/usage-windows";

/**
 * Tokens and cost for the Home widgets: org totals from every session, plus
 * top cases, workflows, projects and agents over the last 30 days. The totals
 * of top cases and runs are lifetime totals of the cases and runs active in
 * that window.
 */

const DAY_MS = 86_400_000;
const CASES_MAX = 500;
const RUNS_MAX = 1000;

export const orgUsageStatsService = {
  async get(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgUsageStats> {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const [windowed, cases, runs] = await Promise.all([
      loadWindowedUsage(organizationId, { now }),
      withDb((db) =>
        db.orchestratorCase.findMany({
          where: { organizationId, updatedAt: { gte: since30 } },
          orderBy: { updatedAt: "desc" },
          take: CASES_MAX,
          select: { id: true, title: true, workflowId: true, projectId: true },
        })
      ),
      withDb((db) =>
        db.workflowRun.findMany({
          where: { organizationId, createdAt: { gte: since30 } },
          orderBy: { createdAt: "desc" },
          take: RUNS_MAX,
          select: {
            id: true,
            workflowId: true,
            projectId: true,
            loops: { select: { loopId: true } },
          },
        })
      ),
    ]);
    const loopIds = [
      ...new Set(runs.flatMap((run) => run.loops.map((loop) => loop.loopId))),
    ];
    const [caseStats, loopUsage] = await Promise.all([
      loadCaseStats(
        organizationId,
        cases.map((row) => row.id),
        now
      ),
      loadLoopUsage(organizationId, loopIds, now),
    ]);
    const caseUnits = cases.map((row) => ({
      row,
      usage: caseStats.get(row.id),
    }));
    const runUnits = runs.map((run) => ({
      run,
      usage: sumLoops(
        run.loops.map((loop) => loop.loopId),
        loopUsage
      ),
    }));
    const byWorkflow = sumByKey([
      ...caseUnits.flatMap(({ row, usage }) =>
        usage ? [{ key: row.workflowId, usage }] : []
      ),
      ...runUnits.map(({ run, usage }) => ({ key: run.workflowId, usage })),
    ]);
    const byProject = sumByKey([
      ...caseUnits.flatMap(({ row, usage }) =>
        usage ? [{ key: row.projectId, usage }] : []
      ),
      ...runUnits.map(({ run, usage }) => ({ key: run.projectId, usage })),
    ]);
    const byCase = sumByKey(
      caseUnits.flatMap(({ row, usage }) =>
        usage ? [{ key: row.id, usage }] : []
      )
    );
    const agentTotals = sumByKey(
      [...windowed.byAgent].map(([key, usage]) => ({ key, usage }))
    );
    const [workflows, projects, targets] = await Promise.all([
      loadNames(organizationId, [...byWorkflow.keys()], "workflow"),
      loadNames(organizationId, [...byProject.keys()], "project"),
      loadNames(organizationId, [...agentTotals.keys()], "computeTarget"),
    ]);
    return {
      last7d: toTotals(windowed.last7d),
      last30d: toTotals(windowed.last30d),
      topCases: topRows(
        byCase,
        new Map(cases.map((row) => [row.id, row.title]))
      ),
      topWorkflows: topRows(byWorkflow, workflows),
      topProjects: topRows(byProject, projects),
      topAgents: topRows(agentTotals, targets),
    };
  },
};

function toTotals(usage: UsageTotals): OrgUsageTotals {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  };
}

function sumLoops(
  loopIds: string[],
  usageByLoop: Map<string, UsageTotals>
): UsageTotals {
  let total = emptyUsage();
  for (const id of loopIds) {
    const usage = usageByLoop.get(id);
    if (usage) {
      total = addUsage(total, usage);
    }
  }
  return { ...total, activeMs: 0 };
}

async function loadNames(
  organizationId: string,
  ids: string[],
  table: "workflow" | "project" | "computeTarget"
): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  if (table === "computeTarget") {
    const rows = await withDb((db) =>
      db.computeTarget.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, machineName: true },
      })
    );
    return new Map(rows.map((row) => [row.id, row.machineName]));
  }
  const rows = await withDb((db) =>
    table === "workflow"
      ? db.workflow.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, name: true },
        })
      : db.project.findMany({
          where: { organizationId, id: { in: ids } },
          select: { id: true, name: true },
        })
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}
