import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventDeleteMany: vi.fn(),
  deliveryDeleteMany: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      workflowEvent: { deleteMany: mocks.eventDeleteMany },
      integrationDelivery: { deleteMany: mocks.deliveryDeleteMany },
    }),
}));

import {
  INBOUND_HISTORY_RETENTION_DAYS,
  workflowEventRetentionService,
} from "@/app/workflows/workflow-event-retention-service";

describe("workflowEventRetentionService.prune", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventDeleteMany.mockResolvedValue({ count: 7 });
    mocks.deliveryDeleteMany.mockResolvedValue({ count: 3 });
  });

  it("deletes events and deliveries received before now minus 30 days", async () => {
    const now = new Date("2026-11-05T12:00:00.000Z");
    const cutoff = new Date("2026-10-06T12:00:00.000Z");

    const result = await workflowEventRetentionService.prune(now);

    expect(INBOUND_HISTORY_RETENTION_DAYS).toBe(30);
    expect(mocks.eventDeleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: cutoff } },
    });
    expect(mocks.deliveryDeleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: cutoff } },
    });
    expect(result).toEqual({ events: 7, deliveries: 3 });
  });
});
