import { Prisma, withDb } from "@repo/database";
import type { UsageTotals } from "@/lib/usage/loop-usage";
import {
  addCost,
  addUsage,
  emptyUsage,
  turnUsage,
} from "@/lib/usage/loop-usage";

/**
 * Org-wide (or one agent's) usage for the last 7 and 30 days: every session
 * of the organization, loops that have no synced session, and orchestrator
 * turns. A session's numbers win over its loop's.
 */

const DAY_MS = 86_400_000;

export type UsageGroupRow = {
  compute_target_id: string | null;
  in7d: boolean;
  input_tokens: bigint | number | null;
  output_tokens: bigint | number | null;
  cost_usd: unknown;
  cost_known: number | bigint;
  active_ms: bigint | number | null;
};

export type WindowTurnRow = {
  usage: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  computeTargetId: string | null;
};

export type WindowedUsage = {
  last7d: UsageTotals;
  last30d: UsageTotals;
  /** 30-day totals per compute target. */
  byAgent: Map<string, UsageTotals>;
};

export async function loadWindowedUsage(
  organizationId: string,
  options: { now?: Date; computeTargetId?: string } = {}
): Promise<WindowedUsage> {
  const now = options.now ?? new Date();
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const { computeTargetId } = options;
  const sessionTarget = computeTargetId
    ? Prisma.sql`AND sd.compute_target_id = ${computeTargetId}::uuid`
    : Prisma.empty;
  const loopTarget = computeTargetId
    ? Prisma.sql`AND l.compute_target_id = ${computeTargetId}::uuid`
    : Prisma.empty;
  // The SQL mirrors `sessionActiveMs`/`resolveLoopUsage`; change both together.
  const [groups, turns] = await Promise.all([
    withDb((db) =>
      db.$queryRaw<UsageGroupRow[]>(
        Prisma.sql`
          WITH units AS (
            SELECT sd.compute_target_id, sd.session_started_at AS at,
                   sd.input_tokens::bigint AS input_tokens, sd.output_tokens::bigint AS output_tokens,
                   sd.estimated_cost::numeric AS cost,
                   COALESCE(NULLIF(r.runtime_ms, 0),
                     GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(sd.session_ended_at, sd.last_activity_at, sd.session_updated_at) - sd.session_started_at)) * 1000))::bigint AS active_ms
            FROM session_detail sd
            JOIN artifacts a ON a.id = sd.artifact_id
            LEFT JOIN agent_session_usage_rollups r ON r.artifact_id = sd.artifact_id
            WHERE a.organization_id = ${organizationId}::uuid AND sd.session_started_at >= ${since30}
              ${sessionTarget}
            UNION ALL
            SELECT l.compute_target_id, l.created_at, l.tokens_input::bigint, l.tokens_output::bigint, l.estimated_cost::numeric,
                   CASE WHEN l.started_at IS NULL THEN 0
                        ELSE GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(l.completed_at, ${now}) - l.started_at)) * 1000) END::bigint
            FROM loops l
            WHERE l.organization_id = ${organizationId}::uuid AND l.created_at >= ${since30}
              ${loopTarget}
              AND NOT EXISTS (SELECT 1 FROM session_detail s2
                              WHERE s2.source_loop_id = l.id::text OR s2.artifact_id = l.session_artifact_id)
          )
          SELECT compute_target_id, (at >= ${since7}) AS in7d,
                 SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens,
                 SUM(cost) AS cost_usd, COUNT(cost)::int AS cost_known, SUM(active_ms)::bigint AS active_ms
          FROM units GROUP BY 1, 2
        `
      )
    ),
    withDb((db) =>
      db.orchestratorTurn.findMany({
        where: {
          organizationId,
          startedAt: { gte: since30 },
          ...(computeTargetId ? { computeTargetId } : {}),
        },
        select: {
          usage: true,
          startedAt: true,
          finishedAt: true,
          computeTargetId: true,
        },
      })
    ),
  ]);
  return foldWindowedUsage(groups, turns, since7, now);
}

export function foldWindowedUsage(
  groups: UsageGroupRow[],
  turns: WindowTurnRow[],
  since7: Date,
  now: Date
): WindowedUsage {
  let last7d = emptyUsage();
  let last30d = emptyUsage();
  const byAgent = new Map<string, UsageTotals>();
  const add = (part: UsageTotals, in7d: boolean, target: string | null) => {
    last30d = addUsage(last30d, part);
    if (in7d) {
      last7d = addUsage(last7d, part);
    }
    if (target !== null) {
      byAgent.set(target, addUsage(byAgent.get(target) ?? emptyUsage(), part));
    }
  };
  for (const group of groups) {
    const cost = Number(group.cost_usd);
    add(
      {
        inputTokens: Number(group.input_tokens ?? 0),
        outputTokens: Number(group.output_tokens ?? 0),
        costUsd:
          Number(group.cost_known) > 0 && Number.isFinite(cost)
            ? addCost(null, cost)
            : null,
        activeMs: Number(group.active_ms ?? 0),
      },
      group.in7d,
      group.compute_target_id
    );
  }
  for (const turn of turns) {
    add(
      turnUsage(turn, now),
      turn.startedAt.getTime() >= since7.getTime(),
      turn.computeTargetId
    );
  }
  return { last7d, last30d, byAgent };
}
