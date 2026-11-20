import {
  WorkflowActionRunStatus,
  WorkflowActionStage,
  WorkflowRunErrorCode,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ITEM_QUEUE_ACTIONS_RETRY_MS,
  ITEM_QUEUE_ACTIONS_WAIT_MS,
  ITEM_QUEUE_RETRY_MS,
  itemQueueWait,
  itemRetryGuard,
  nextQueuedItemRun,
  pickQueueHolder,
  readSameItem,
} from "@/lib/workflows/engine/item-queue";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  countActions: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      workflowRun: {
        findUnique: mocks.findUnique,
        findMany: mocks.findMany,
        findFirst: mocks.findFirst,
        updateMany: mocks.updateMany,
      },
      workflowActionRun: { count: mocks.countActions },
    }),
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const NOW = new Date("2026-01-01T12:00:00Z");
const KEY = {
  id: "run-2",
  organizationId: "org-1",
  workflowId: "wf-1",
  sourceKey: "thread-1",
  createdAt: new Date("2026-01-01T11:00:00Z"),
};
const QUEUE_CONFIG = { sameItem: WorkflowSameItem.Queue };
const RUN = {
  id: KEY.id,
  organizationId: "org-1",
  agentConfig: QUEUE_CONFIG,
};

function other(id: string, status: WorkflowRunStatus, createdAt: Date) {
  return { id, status, createdAt };
}

const EARLIER = new Date("2026-01-01T10:00:00Z");
const LATER = new Date("2026-01-01T11:30:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUnique.mockResolvedValue(KEY);
  mocks.findMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.countActions.mockResolvedValue(0);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("readSameItem", () => {
  it("defaults to ignore and ignores orchestrated workflows", () => {
    expect(readSameItem({})).toBe(WorkflowSameItem.Ignore);
    expect(readSameItem(null)).toBe(WorkflowSameItem.Ignore);
    expect(readSameItem(QUEUE_CONFIG)).toBe(WorkflowSameItem.Queue);
    expect(
      readSameItem({
        mode: WorkflowAgentMode.Orchestrated,
        sameItem: WorkflowSameItem.Queue,
      })
    ).toBe(WorkflowSameItem.Ignore);
  });
});

describe("pickQueueHolder", () => {
  it("is held by a started run even when it is later by createdAt", () => {
    for (const status of [
      WorkflowRunStatus.Running,
      WorkflowRunStatus.NeedsInput,
      WorkflowRunStatus.Ingesting,
    ]) {
      expect(pickQueueHolder(KEY, [other("run-3", status, LATER)])).toEqual({
        id: "run-3",
        status,
      });
    }
  });

  it("is held by an earlier received run, not a later one", () => {
    expect(
      pickQueueHolder(KEY, [
        other("run-1", WorkflowRunStatus.Received, EARLIER),
      ])
    ).toEqual({ id: "run-1", status: WorkflowRunStatus.Received });
    expect(
      pickQueueHolder(KEY, [other("run-3", WorkflowRunStatus.Received, LATER)])
    ).toBeNull();
  });

  it("breaks a createdAt tie by id", () => {
    const tied = [other("run-1", WorkflowRunStatus.Received, KEY.createdAt)];
    expect(pickQueueHolder(KEY, tied)?.id).toBe("run-1");
    expect(
      pickQueueHolder(KEY, [
        other("run-3", WorkflowRunStatus.Received, KEY.createdAt),
      ])
    ).toBeNull();
  });

  it("lets only the first of three runs proceed", () => {
    const first = other("run-1", WorkflowRunStatus.Received, EARLIER);
    const second = other("run-2", WorkflowRunStatus.Received, KEY.createdAt);
    const third = other("run-3", WorkflowRunStatus.Received, LATER);
    expect(pickQueueHolder(first, [second, third])).toBeNull();
    expect(pickQueueHolder(third, [first, second])?.id).toBe("run-1");
    expect(pickQueueHolder(third, [second])?.id).toBe("run-2");
  });
});

describe("itemQueueWait", () => {
  it("does not query for ignore or an absent setting", async () => {
    expect(await itemQueueWait({ ...RUN, agentConfig: {} }, NOW)).toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("queries only the item's non-final runs", async () => {
    await itemQueueWait(RUN, NOW);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          workflowId: "wf-1",
          sourceKey: "thread-1",
          id: { not: "run-2" },
        }),
        take: 50,
      })
    );
  });

  it("retries while another run holds the item", async () => {
    mocks.findMany.mockResolvedValue([
      other("run-1", WorkflowRunStatus.Running, EARLIER),
    ]);
    expect(await itemQueueWait(RUN, NOW)).toMatchObject({
      kind: "retry",
      delayMs: ITEM_QUEUE_RETRY_MS,
      error: { code: WorkflowRunErrorCode.ItemQueued },
    });
  });

  it("starts after a previous run that ended without open post rows", async () => {
    for (const status of [
      WorkflowRunStatus.Failed,
      WorkflowRunStatus.Cancelled,
      WorkflowRunStatus.Succeeded,
    ]) {
      mocks.findFirst.mockResolvedValue({
        id: "run-1",
        status,
        cycle: 1,
        completedAt: NOW,
        updatedAt: NOW,
      });
      expect(await itemQueueWait(RUN, NOW)).toBeNull();
    }
  });

  it("waits for the previous run's open reply, filtered to its final events", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "run-1",
      status: WorkflowRunStatus.Succeeded,
      cycle: 2,
      completedAt: new Date(NOW.getTime() - 60_000),
      updatedAt: NOW,
    });
    mocks.countActions.mockResolvedValue(1);
    expect(await itemQueueWait(RUN, NOW)).toMatchObject({
      kind: "retry",
      delayMs: ITEM_QUEUE_ACTIONS_RETRY_MS,
    });
    expect(mocks.countActions).toHaveBeenCalledWith({
      where: {
        runId: "run-1",
        stage: WorkflowActionStage.Post,
        cycle: 2,
        event: {
          in: [WorkflowRunEvent.Succeeded, WorkflowRunEvent.Failed],
        },
        status: {
          in: [
            WorkflowActionRunStatus.Pending,
            WorkflowActionRunStatus.Running,
            WorkflowActionRunStatus.Waiting,
          ],
        },
      },
    });
  });

  it("starts when the post rows are final", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "run-1",
      status: WorkflowRunStatus.Succeeded,
      cycle: 1,
      completedAt: NOW,
      updatedAt: NOW,
    });
    mocks.countActions.mockResolvedValue(0);
    expect(await itemQueueWait(RUN, NOW)).toBeNull();
  });

  it("starts anyway once 15 minutes passed since the previous run ended", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "run-1",
      status: WorkflowRunStatus.Succeeded,
      cycle: 1,
      completedAt: new Date(NOW.getTime() - ITEM_QUEUE_ACTIONS_WAIT_MS),
      updatedAt: NOW,
    });
    mocks.countActions.mockResolvedValue(1);
    expect(await itemQueueWait(RUN, NOW)).toBeNull();
  });
});

describe("nextQueuedItemRun", () => {
  beforeEach(() => {
    mocks.findUnique.mockResolvedValue({
      ...KEY,
      agentConfig: QUEUE_CONFIG,
    });
  });

  it("clears the delay of the earliest received run and returns it", async () => {
    mocks.findMany.mockResolvedValue([
      other("run-3", WorkflowRunStatus.Received, LATER),
      other("run-4", WorkflowRunStatus.Received, LATER),
    ]);
    expect(await nextQueuedItemRun("run-2", "org-1")).toBe("run-3");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-3",
        organizationId: "org-1",
        status: WorkflowRunStatus.Received,
      },
      data: { nextStepAt: null },
    });
  });

  it("returns null for ignore", async () => {
    mocks.findUnique.mockResolvedValue({ ...KEY, agentConfig: {} });
    expect(await nextQueuedItemRun("run-2", "org-1")).toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns null when another run is past received, or none is open", async () => {
    mocks.findMany.mockResolvedValue([
      other("run-3", WorkflowRunStatus.Received, LATER),
      other("run-4", WorkflowRunStatus.NeedsInput, LATER),
    ]);
    expect(await nextQueuedItemRun("run-2", "org-1")).toBeNull();
    mocks.findMany.mockResolvedValue([]);
    expect(await nextQueuedItemRun("run-2", "org-1")).toBeNull();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe("itemRetryGuard", () => {
  const run = { ...KEY, agentConfig: QUEUE_CONFIG };

  it("is null for ignore without a query", async () => {
    expect(await itemRetryGuard({ ...run, agentConfig: {} })).toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("is busy while another run of the item is open", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "run-3" });
    expect(await itemRetryGuard(run)).toBe("busy");
  });

  it("is moved_on for queue_resume with a later run", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "run-3" });
    expect(
      await itemRetryGuard({
        ...run,
        agentConfig: { sameItem: WorkflowSameItem.QueueResume },
      })
    ).toBe("moved_on");
  });

  it("allows queue with a later finished run", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await itemRetryGuard(run)).toBeNull();
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
  });
});
