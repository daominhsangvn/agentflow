import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowRunService } from "@/lib/workflows/run-service";

const IDS = {
  org: "0199a5f0-0000-7000-8000-00000000000a",
  project: "0199a5f0-0000-7000-8000-0000000000c1",
  workflow: "0199a5f0-0000-7000-8000-0000000000f1",
};

const mocks = vi.hoisted(() => ({
  db: {
    workflowRun: { findMany: vi.fn() },
    workflow: { findFirst: vi.fn() },
  },
}));

vi.mock("@repo/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/database")>()),
  withDb: (fn: (db: unknown) => unknown) => fn(mocks.db),
}));

describe("workflowRunService.list org filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.workflowRun.findMany.mockResolvedValue([]);
  });

  it("puts projectId and organizationId in the where", async () => {
    await workflowRunService.list(IDS.org, { projectId: IDS.project });

    const where = mocks.db.workflowRun.findMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      organizationId: IDS.org,
      projectId: IDS.project,
    });
    expect(where).not.toHaveProperty("workflowId");
  });

  it("returns not found for a workflow outside the organization", async () => {
    mocks.db.workflow.findFirst.mockResolvedValue(null);

    const result = await workflowRunService.list(IDS.org, {
      workflowId: IDS.workflow,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(Status.NotFound);
    }
    expect(mocks.db.workflowRun.findMany).not.toHaveBeenCalled();
  });
});
