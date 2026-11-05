import { withDb } from "@repo/database";
import { readTurnUsage } from "@/app/orchestrator/cases/case-mappers";

/**
 * Tokens, cost and active time of loops and orchestrator turns. A session's
 * numbers win over its loop's: a loop's own numbers are used only when the loop
 * has no synced session, never both.
 */

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  /** Null when no cost is known (unknown is not zero). */
  costUsd: number | null;
  activeMs: number;
};

export type SessionUsageRow = {
  artifactId: string;
  sourceLoopId: string | null;
  inputTokens: bigint | number;
  outputTokens: bigint | number;
  /** Prisma Decimal. */
  estimatedCost: unknown;
  sessionStartedAt: Date;
  sessionEndedAt: Date | null;
  lastActivityAt: Date | null;
  sessionUpdatedAt: Date;
  usageRollup: { runtimeMs: bigint | number | null } | null;
};

export type LoopUsageRow = {
  id: string;
  sessionArtifactId: string | null;
  tokensInput: number;
  tokensOutput: number;
  /** Prisma Decimal or null. */
  estimatedCost: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
};

export const SESSION_USAGE_SELECT = {
  artifactId: true,
  sourceLoopId: true,
  inputTokens: true,
  outputTokens: true,
  estimatedCost: true,
  sessionStartedAt: true,
  sessionEndedAt: true,
  lastActivityAt: true,
  sessionUpdatedAt: true,
  usageRollup: { select: { runtimeMs: true } },
} as const;

export const LOOP_USAGE_SELECT = {
  id: true,
  sessionArtifactId: true,
  tokensInput: true,
  tokensOutput: true,
  estimatedCost: true,
  startedAt: true,
  completedAt: true,
} as const;

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, costUsd: null, activeMs: 0 };
}

export function addCost(
  total: number | null,
  part: number | null
): number | null {
  if (part === null) {
    return total;
  }
  return (total ?? 0) + part;
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: addCost(a.costUsd, b.costUsd),
    activeMs: a.activeMs + b.activeMs,
  };
}

/** Mirrored by the SQL in `usage-windows.ts`: change both together. */
export function sessionActiveMs(row: SessionUsageRow, now: Date): number {
  const runtime = Number(row.usageRollup?.runtimeMs ?? 0);
  if (Number.isFinite(runtime) && runtime > 0) {
    return runtime;
  }
  const end = row.sessionEndedAt ?? row.lastActivityAt ?? row.sessionUpdatedAt;
  return spanMs(row.sessionStartedAt, end ?? now);
}

export function sessionUsage(row: SessionUsageRow, now: Date): UsageTotals {
  const cost = Number(row.estimatedCost);
  return {
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costUsd: Number.isFinite(cost) ? cost : null,
    activeMs: sessionActiveMs(row, now),
  };
}

/** Mirrored by the SQL in `usage-windows.ts`: change both together. */
export function resolveLoopUsage(
  loop: LoopUsageRow,
  sessions: SessionUsageRow[],
  now: Date
): UsageTotals {
  const matched = new Map<string, SessionUsageRow>();
  for (const session of sessions) {
    if (
      session.sourceLoopId === loop.id ||
      (loop.sessionArtifactId !== null &&
        session.artifactId === loop.sessionArtifactId)
    ) {
      matched.set(session.artifactId, session);
    }
  }
  if (matched.size > 0) {
    let total = emptyUsage();
    for (const session of matched.values()) {
      total = addUsage(total, sessionUsage(session, now));
    }
    return total;
  }
  const cost =
    loop.estimatedCost === null || loop.estimatedCost === undefined
      ? null
      : Number(loop.estimatedCost);
  return {
    inputTokens: loop.tokensInput,
    outputTokens: loop.tokensOutput,
    costUsd: cost !== null && Number.isFinite(cost) ? cost : null,
    activeMs:
      loop.startedAt === null
        ? 0
        : spanMs(loop.startedAt, loop.completedAt ?? now),
  };
}

export function turnUsage(
  turn: { usage: unknown; startedAt: Date; finishedAt: Date | null },
  now: Date
): UsageTotals {
  const usage = readTurnUsage(turn.usage);
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: usage?.costUsd ?? null,
    activeMs: spanMs(turn.startedAt, turn.finishedAt ?? now),
  };
}

/** One loop query and one session query for all loops. */
export async function loadLoopUsage(
  organizationId: string,
  loopIds: string[],
  now: Date = new Date()
): Promise<Map<string, UsageTotals>> {
  const result = new Map<string, UsageTotals>();
  if (loopIds.length === 0) {
    return result;
  }
  const loops = await withDb((db) =>
    db.loop.findMany({
      where: { organizationId, id: { in: loopIds } },
      select: LOOP_USAGE_SELECT,
    })
  );
  const sessionArtifactIds = loops.flatMap((loop) =>
    loop.sessionArtifactId === null ? [] : [loop.sessionArtifactId]
  );
  const sessions = await withDb((db) =>
    db.sessionDetail.findMany({
      where: {
        artifact: { is: { organizationId } },
        OR:
          sessionArtifactIds.length > 0
            ? [
                { sourceLoopId: { in: loopIds } },
                { artifactId: { in: sessionArtifactIds } },
              ]
            : [{ sourceLoopId: { in: loopIds } }],
      },
      select: SESSION_USAGE_SELECT,
    })
  );
  for (const loop of loops) {
    result.set(loop.id, resolveLoopUsage(loop, sessions, now));
  }
  return result;
}

function spanMs(from: Date, to: Date): number {
  return Math.max(0, to.getTime() - from.getTime());
}
