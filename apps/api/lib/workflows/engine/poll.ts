import type { JsonValue } from "@repo/api/src/types/common";
import {
  IntegrationConnectionStatus,
  IntegrationDeliveryMode,
  IntegrationDeliverySource,
} from "@repo/api/src/types/integration";
import { withDb } from "@repo/database";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import pLimit from "p-limit";
import { mapWithDbConcurrency } from "@/lib/db-fanout";
import {
  createProviderContext,
  type LoadedConnection,
  loadConnectionRuntime,
  recordConnectionPollResult,
} from "@/lib/integrations/connection-service";
import { loadConnectionPollScopes } from "@/lib/integrations/project-connections";
import type { InboundEvent } from "@/lib/integrations/types";
import { jsonValueSchema } from "@/lib/json-schema";
import { scrubProviderError } from "./errors";
import { ingestEvents, toDeliveryPayload } from "./ingest";

/**
 * Polls connections in poll delivery mode whose nextPollAt is due
 * (docs/workflows.md "Poll"). Each returned event is ingested as its own
 * delivery (`poll:<dedupKey>`), so webhook and poll never start the same run
 * twice. A failed poll records lastError and still schedules the next poll.
 */

export const POLL_BATCH_LIMIT = 20;
const POLL_CONCURRENCY = 4;
const DELIVERY_ID_PREFIX = "poll:";
const LOG_PREFIX = "[workflows/poll]";

export type PollSummary = {
  polled: number;
  failed: number;
  events: number;
  runs: number;
};

type DueConnection = {
  id: string;
  organizationId: string;
  pollIntervalSeconds: number;
  pollCursor: unknown;
};

type ConnectionPollOutcome = { ok: boolean; events: number; runs: number };

export function pollDueConnections(
  now: Date = new Date()
): Promise<PollSummary> {
  return withSpan("workflow.poll", {}, async (span) => {
    const summary = await pollDue(now);
    span.setAttributes({
      "af.workflow.polled": summary.polled,
      "af.workflow.poll_failed": summary.failed,
      "af.workflow.poll_events": summary.events,
    });
    return summary;
  });
}

async function pollDue(now: Date): Promise<PollSummary> {
  // Disabled connections are never polled; connections in error state still
  // are (a failed connection test must not silently stop delivery), and their
  // poll errors land in lastError.
  const due = await withDb((db) =>
    db.integrationConnection.findMany({
      where: {
        deliveryMode: IntegrationDeliveryMode.Poll,
        status: { not: IntegrationConnectionStatus.Disabled },
        nextPollAt: { lte: now },
      },
      orderBy: { nextPollAt: "asc" },
      take: POLL_BATCH_LIMIT,
      select: {
        id: true,
        organizationId: true,
        pollIntervalSeconds: true,
        pollCursor: true,
      },
    })
  );
  const outcomes = await mapWithDbConcurrency(
    due,
    (connection) =>
      withSpan(
        "integration.poll",
        {
          [AfAttribute.ConnectionId]: connection.id,
          [AfAttribute.OrgId]: connection.organizationId,
        },
        (span) => pollConnection(connection, now, span)
      ),
    pLimit(POLL_CONCURRENCY)
  );
  const summary: PollSummary = { polled: 0, failed: 0, events: 0, runs: 0 };
  for (const outcome of outcomes) {
    if (!outcome) {
      continue;
    }
    summary.polled += 1;
    summary.events += outcome.events;
    summary.runs += outcome.runs;
    if (!outcome.ok) {
      summary.failed += 1;
    }
  }
  return summary;
}

/** Returns null when another worker claimed the poll first. */
async function pollConnection(
  connection: DueConnection,
  now: Date,
  span: PollSpan
): Promise<ConnectionPollOutcome | null> {
  const nextPollAt = new Date(
    now.getTime() + connection.pollIntervalSeconds * 1000
  );
  if (!(await claimPoll(connection.id, now, nextPollAt))) {
    setSpanOutcome(AfOutcome.Skipped, undefined, span);
    return null;
  }
  const loaded = await loadConnectionRuntime(
    connection.organizationId,
    connection.id
  );
  const poll = loaded?.provider.inbound?.poll;
  if (loaded) {
    span.setAttribute(AfAttribute.IntegrationProvider, loaded.provider.key);
  }
  if (!(loaded && poll)) {
    setSpanOutcome(AfOutcome.Error, "poll_unavailable", span);
    await recordConnectionPollResult(connection.id, {
      error: loaded
        ? `${loaded.provider.displayName} does not support polling.`
        : "The connection could not be loaded. Check its credentials.",
      nextPollAt,
    });
    return { ok: false, events: 0, runs: 0 };
  }

  try {
    const result = await poll(
      createProviderContext(loaded.runtime, LOG_PREFIX),
      readCursor(connection.pollCursor),
      {
        intervalSeconds: connection.pollIntervalSeconds,
        loadScopes: () =>
          loadConnectionPollScopes(
            connection.organizationId,
            connection.id,
            loaded.provider
          ),
      }
    );
    const runs = await ingestPolledEvents(loaded, result.events);
    await recordConnectionPollResult(connection.id, {
      cursor: result.cursor,
      error: null,
      nextPollAt,
    });
    return { ok: true, events: result.events.length, runs };
  } catch (error) {
    const message = scrubProviderError(error, loaded.runtime.secrets);
    log.warn(`${LOG_PREFIX} Poll failed`, {
      connectionId: connection.id,
      organizationId: connection.organizationId,
      provider: loaded.provider.key,
      error: message,
    });
    setSpanOutcome(AfOutcome.Error, message, span);
    // The cursor is kept, so the next poll covers the same window again.
    await recordConnectionPollResult(connection.id, {
      error: message,
      nextPollAt,
    });
    return { ok: false, events: 0, runs: 0 };
  }
}

/**
 * Moves nextPollAt forward before polling, so overlapping ticks never poll
 * the same connection twice.
 */
async function claimPoll(
  connectionId: string,
  now: Date,
  nextPollAt: Date
): Promise<boolean> {
  const claimed = await withDb((db) =>
    db.integrationConnection.updateMany({
      where: { id: connectionId, nextPollAt: { lte: now } },
      data: { nextPollAt },
    })
  );
  return claimed.count === 1;
}

async function ingestPolledEvents(
  loaded: LoadedConnection,
  events: InboundEvent[]
): Promise<number> {
  let runs = 0;
  for (const event of events) {
    const result = await ingestEvents({
      connection: loaded,
      source: IntegrationDeliverySource.Poll,
      deliveryId: `${DELIVERY_ID_PREFIX}${event.dedupKey}`,
      eventType: event.triggerType,
      events: [event],
      payload: toDeliveryPayload(event),
    });
    runs += result.runCount;
  }
  return runs;
}

function readCursor(value: unknown): JsonValue | null {
  const parsed = jsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type PollSpan = NonNullable<Parameters<typeof setSpanOutcome>[2]>;
