import {
  ORG_ACTIVITY_DAYS,
  type OrgActivityDay,
  type OrgActivityStats,
} from "@repo/api/src/types/org-stats";
import {
  WORKFLOW_RUN_FINAL_STATUSES,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { Prisma, withDb } from "@repo/database";
import { AfAttribute } from "@repo/observability/af-attributes";
import { withSpan } from "@repo/observability/span";
import { addCost, turnUsage } from "@/lib/usage/loop-usage";
import { usageUnitsSql } from "@/lib/usage/usage-windows";

/**
 * Daily activity of the last 30 UTC days for the Home chart: tokens, cost and
 * sessions (sessions, loops without a session, orchestrator turns), finished
 * workflow runs by outcome, and cases opened and closed. Aggregated in SQL,
 * one query per measure, zero-filled and oldest first.
 */

const DAY_MS = 86_400_000;

type UsageDayRow = {
  day: Date | string;
  input_tokens: bigint | number | null;
  output_tokens: bigint | number | null;
  cost_usd: unknown;
  cost_known: number | bigint;
  units: number | bigint;
};
type CountDayRow = { day: Date | string; n: number | bigint };
type RunDayRow = { day: Date | string; status: string; n: number | bigint };
type TurnRow = { usage: unknown; startedAt: Date; finishedAt: Date | null };

type DayAccumulator = {
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  units: number;
};

export const orgActivityStatsService = {
  get(
    organizationId: string,
    now: Date = new Date()
  ): Promise<OrgActivityStats> {
    return withSpan(
      "org_stats.activity",
      { [AfAttribute.OrgId]: organizationId },
      async () => {
        const start = startOfWindow(now);
        const [usageRows, sessionRows, turns, runRows, openedRows, closedRows] =
          await Promise.all([
            withDb((db) =>
              db.$queryRaw<UsageDayRow[]>(Prisma.sql`
                WITH units AS (${usageUnitsSql(organizationId, start, now)})
                SELECT date_trunc('day', at AT TIME ZONE 'UTC')::date AS day,
                       SUM(input_tokens)::bigint AS input_tokens,
                       SUM(output_tokens)::bigint AS output_tokens,
                       SUM(cost) AS cost_usd, COUNT(cost)::int AS cost_known,
                       COUNT(*)::int AS units
                FROM units GROUP BY 1
              `)
            ),
            withDb((db) =>
              db.$queryRaw<CountDayRow[]>(Prisma.sql`
                SELECT date_trunc('day', sd.session_started_at AT TIME ZONE 'UTC')::date AS day,
                       COUNT(*)::int AS n
                FROM session_detail sd
                JOIN artifacts a ON a.id = sd.artifact_id
                WHERE a.organization_id = ${organizationId}::uuid
                  AND sd.session_started_at >= ${start}
                GROUP BY 1
              `)
            ),
            withDb((db) =>
              db.orchestratorTurn.findMany({
                where: { organizationId, startedAt: { gte: start } },
                select: { usage: true, startedAt: true, finishedAt: true },
              })
            ),
            withDb((db) =>
              db.$queryRaw<RunDayRow[]>(Prisma.sql`
                SELECT date_trunc('day', completed_at AT TIME ZONE 'UTC')::date AS day,
                       status, COUNT(*)::int AS n
                FROM workflow_runs
                WHERE organization_id = ${organizationId}::uuid
                  AND completed_at >= ${start}
                  AND status IN (${Prisma.join([...WORKFLOW_RUN_FINAL_STATUSES])})
                GROUP BY 1, 2
              `)
            ),
            withDb((db) =>
              db.$queryRaw<CountDayRow[]>(Prisma.sql`
                SELECT date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
                       COUNT(*)::int AS n
                FROM orchestrator_cases
                WHERE organization_id = ${organizationId}::uuid AND created_at >= ${start}
                GROUP BY 1
              `)
            ),
            withDb((db) =>
              db.$queryRaw<CountDayRow[]>(Prisma.sql`
                SELECT date_trunc('day', closed_at AT TIME ZONE 'UTC')::date AS day,
                       COUNT(*)::int AS n
                FROM orchestrator_cases
                WHERE organization_id = ${organizationId}::uuid AND closed_at >= ${start}
                GROUP BY 1
              `)
            ),
          ]);

        const days = buildEmptyDays(start);
        const byDay = new Map(days.map((day) => [day.day, day]));
        applyUsage(byDay, usageRows, turns, now);
        applyCounts(byDay, sessionRows, "sessions");
        applyCounts(byDay, openedRows, "casesOpened");
        applyCounts(byDay, closedRows, "casesClosed");
        for (const row of runRows) {
          const day = byDay.get(dayKey(row.day));
          if (day) {
            foldRun(day, row);
          }
        }
        return { days };
      }
    );
  },
};

function startOfWindow(now: Date): Date {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return new Date(today - (ORG_ACTIVITY_DAYS - 1) * DAY_MS);
}

function buildEmptyDays(start: Date): OrgActivityDay[] {
  return Array.from({ length: ORG_ACTIVITY_DAYS }, (_, index) => ({
    day: dayKey(new Date(start.getTime() + index * DAY_MS)),
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    runsSucceeded: 0,
    runsFailed: 0,
    runsCancelled: 0,
    casesOpened: 0,
    casesClosed: 0,
  }));
}

function dayKey(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function applyCounts(
  byDay: Map<string, OrgActivityDay>,
  rows: CountDayRow[],
  field: "sessions" | "casesOpened" | "casesClosed"
): void {
  for (const row of rows) {
    const day = byDay.get(dayKey(row.day));
    if (day) {
      day[field] = Number(row.n);
    }
  }
}

function applyUsage(
  byDay: Map<string, OrgActivityDay>,
  usageRows: UsageDayRow[],
  turns: TurnRow[],
  now: Date
): void {
  const accumulators = new Map<string, DayAccumulator>();
  for (const row of usageRows) {
    foldUsageRow(accumulators, row);
  }
  for (const turn of turns) {
    foldTurn(accumulators, turn, now);
  }
  for (const [key, acc] of accumulators) {
    const day = byDay.get(key);
    if (day) {
      day.inputTokens = acc.inputTokens;
      day.outputTokens = acc.outputTokens;
      // Usage without any priced unit is unknown, not zero.
      day.costUsd = acc.units > 0 ? acc.cost : 0;
    }
  }
}

function accumulatorFor(
  accumulators: Map<string, DayAccumulator>,
  key: string
): DayAccumulator {
  let acc = accumulators.get(key);
  if (!acc) {
    acc = { inputTokens: 0, outputTokens: 0, cost: null, units: 0 };
    accumulators.set(key, acc);
  }
  return acc;
}

function foldUsageRow(
  accumulators: Map<string, DayAccumulator>,
  row: UsageDayRow
): void {
  const acc = accumulatorFor(accumulators, dayKey(row.day));
  const cost = Number(row.cost_usd);
  acc.inputTokens += Number(row.input_tokens ?? 0);
  acc.outputTokens += Number(row.output_tokens ?? 0);
  acc.units += Number(row.units);
  if (Number(row.cost_known) > 0 && Number.isFinite(cost)) {
    acc.cost = addCost(acc.cost, cost);
  }
}

function foldTurn(
  accumulators: Map<string, DayAccumulator>,
  turn: TurnRow,
  now: Date
): void {
  const acc = accumulatorFor(accumulators, dayKey(turn.startedAt));
  const usage = turnUsage(turn, now);
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.units += 1;
  acc.cost = addCost(acc.cost, usage.costUsd);
}

function foldRun(day: OrgActivityDay, row: RunDayRow): void {
  const count = Number(row.n);
  if (row.status === WorkflowRunStatus.Succeeded) {
    day.runsSucceeded += count;
  } else if (row.status === WorkflowRunStatus.Failed) {
    day.runsFailed += count;
  } else if (row.status === WorkflowRunStatus.Cancelled) {
    day.runsCancelled += count;
  }
}
