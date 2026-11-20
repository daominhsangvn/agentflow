import { Status } from "@repo/api/src/types/result";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowRunService } from "@/lib/workflows/run-service";

const IDS = {
  org: "0199a5f0-0000-7000-8000-00000000000a",
  workflow: "0199a5f0-0000-7000-8000-0000000000f1",
};

const mocks = vi.hoisted(() => ({
  db: {
    workflowRun: { findMany: vi.fn(), groupBy: vi.fn() },
    workflow: { findFirst: vi.fn() },
  },
}));

vi.mock("@repo/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/database")>()),
  withDb: (fn: (db: unknown) => unknown) => fn(mocks.db),
}));

describe("workflowRunService.summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.workflowRun.findMany.mockResolvedValue([]);
  });

  it("folds every status into exactly one bucket and totals them", async () => {
    const rows = Object.values(WorkflowRunStatus).map((status) => ({
      status,
      _count: { _all: 1 },
    }));
    mocks.db.workflowRun.groupBy.mockResolvedValue(rows);

    const result = await workflowRunService.summary(IDS.org);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { total, ...buckets } = result.value;
      expect(total).toBe(rows.length);
      expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(total);
      expect(result.value.needsYou).toBe(2);
      expect(result.value.succeeded).toBe(1);
      expect(result.value.failed).toBe(1);
      expect(result.value.cancelled).toBe(1);
      expect(result.value.active).toBe(rows.length - 5);
    }
  });

  it("passes the date window to where.createdAt", async () => {
    mocks.db.workflowRun.groupBy.mockResolvedValue([]);
    const startDate = "2026-11-01T00:00:00.000Z";
    const endDate = "2026-11-10T00:00:00.000Z";

    await workflowRunService.summary(IDS.org, { startDate, endDate });

    const where = mocks.db.workflowRun.groupBy.mock.calls[0]?.[0].where;
    expect(where.organizationId).toBe(IDS.org);
    expect(where.createdAt).toEqual({
      gte: new Date(startDate),
      lte: new Date(endDate),
    });
  });

  it("returns not found for a workflow outside the organization", async () => {
    mocks.db.workflow.findFirst.mockResolvedValue(null);

    const result = await workflowRunService.summary(IDS.org, {
      workflowId: IDS.workflow,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(Status.NotFound);
    }
    expect(mocks.db.workflowRun.groupBy).not.toHaveBeenCalled();
  });

  it("list honours startDate and endDate", async () => {
    await workflowRunService.list(IDS.org, {
      startDate: "2026-11-01T00:00:00.000Z",
    });

    const where = mocks.db.workflowRun.findMany.mock.calls[0]?.[0].where;
    expect(where.createdAt).toEqual({
      gte: new Date("2026-11-01T00:00:00.000Z"),
    });
  });
});
