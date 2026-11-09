import { withDb } from "@repo/database";

export const INBOUND_HISTORY_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

export type InboundHistoryPruneResult = {
  deliveries: number;
  events: number;
};

export const workflowEventRetentionService = {
  /**
   * System sweep across all organizations (the only unscoped query, by
   * design). Deletes workflow events, then deliveries, received before
   * `now - 30 days`. Runs keep working: their delivery link becomes null
   * (SetNull).
   */
  prune(now: Date): Promise<InboundHistoryPruneResult> {
    const cutoff = new Date(
      now.getTime() - INBOUND_HISTORY_RETENTION_DAYS * DAY_MS
    );
    return withDb(async (db) => {
      const events = await db.workflowEvent.deleteMany({
        where: { receivedAt: { lt: cutoff } },
      });
      const deliveries = await db.integrationDelivery.deleteMany({
        where: { receivedAt: { lt: cutoff } },
      });
      return { events: events.count, deliveries: deliveries.count };
    });
  },
};
