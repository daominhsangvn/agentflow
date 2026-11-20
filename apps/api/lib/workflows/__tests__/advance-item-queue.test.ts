import {
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW } from "@/lib/workflows/__tests__/support/advance.test-helpers";
import {
  type AdvanceDbFake,
  AGENT_CONFIG,
  createAdvanceDbFake,
  RUN_ID,
} from "@/lib/workflows/__tests__/support/advance-db.test-fake";
import { advanceRun } from "@/lib/workflows/engine/advance";

const mocks = vi.hoisted(() => ({
  fake: null as AdvanceDbFake | null,
  drainActionRuns: vi.fn(),
  nextQueuedItemRun: vi.fn(),
  itemQueueWait: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@repo/database", async () => {
  const support = await import(
    "@/lib/workflows/__tests__/support/advance-db.test-fake"
  );
  const withDb = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  withDb.tx = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  return { withDb, Prisma: { DbNull: support.PRISMA_DB_NULL } };
});
vi.mock("@/lib/workflows/engine/launch", () => ({
  launchWorkflowLoop: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/launch-step", () => ({
  launchStepLoop: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/documents", () => ({
  ensureRunDocuments: vi.fn(),
  approvePlanDocument: vi.fn(),
  markIssueInReview: vi.fn(),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionRuntime: vi.fn(),
  createProviderContext: (runtime: unknown) => ({ connection: runtime }),
}));
vi.mock("@/app/loops/service", () => ({
  loopsService: { findById: vi.fn() },
}));
vi.mock("@/lib/workflows/engine/actions", () => ({
  enqueueRunEvents: vi.fn().mockResolvedValue(1),
  drainActionRuns: mocks.drainActionRuns,
  hasEnabledPreActions: vi.fn().mockResolvedValue(false),
  hasPostEvents: (events: WorkflowRunEvent[]) =>
    events.some((event) => event !== WorkflowRunEvent.Triggered),
  skipUnfinishedPreActionRuns: vi.fn().mockResolvedValue(0),
  skipPendingPostActionRuns: vi.fn().mockResolvedValue(0),
  RUN_CANCELLED_SKIP_REASON: "The run was cancelled.",
}));
vi.mock("@/lib/workflows/engine/cancel", () => ({ cancelRunLoops: vi.fn() }));
vi.mock("@/lib/workflows/engine/item-queue", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/workflows/engine/item-queue")>();
  return {
    ...original,
    nextQueuedItemRun: mocks.nextQueuedItemRun,
    itemQueueWait: mocks.itemQueueWait,
  };
});
vi.mock("@/lib/wait-until", () => ({ waitUntil: mocks.waitUntil }));

let fake: AdvanceDbFake;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createAdvanceDbFake();
  mocks.fake = fake;
  mocks.drainActionRuns.mockResolvedValue({});
  mocks.itemQueueWait.mockResolvedValue(null);
  mocks.nextQueuedItemRun.mockResolvedValue(null);
});

/** A run of a disabled workflow fails at once, which is a final transition. */
function endingRun(agentConfig: unknown) {
  fake.setRun({
    status: WorkflowRunStatus.Received,
    projectId: "p",
    workflow: { name: "w", enabled: false },
    agentConfig,
  });
}

describe("advanceRun - item queue", () => {
  it("drains once and never looks for a queued run without the setting", async () => {
    endingRun(AGENT_CONFIG);

    await advanceRun(RUN_ID, NOW);

    expect(fake.state.run?.status).toBe(WorkflowRunStatus.Failed);
    expect(mocks.drainActionRuns).toHaveBeenCalledTimes(1);
    expect(mocks.drainActionRuns).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(mocks.nextQueuedItemRun).not.toHaveBeenCalled();
  });

  it("drains, then starts the next queued run of an item with the setting", async () => {
    endingRun({ ...AGENT_CONFIG, sameItem: WorkflowSameItem.Queue });

    await advanceRun(RUN_ID, NOW);

    expect(fake.state.run?.status).toBe(WorkflowRunStatus.Failed);
    expect(mocks.drainActionRuns).not.toHaveBeenCalled();
    const thunk = mocks.waitUntil.mock.calls
      .map((call) => call[0])
      .find((arg) => typeof arg === "function");
    mocks.nextQueuedItemRun.mockResolvedValue("next-run");
    await thunk();

    expect(mocks.drainActionRuns).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(mocks.nextQueuedItemRun).toHaveBeenCalledWith(
      RUN_ID,
      expect.any(String)
    );
    expect(mocks.drainActionRuns.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.nextQueuedItemRun.mock.invocationCallOrder[0]
    );
  });
});
