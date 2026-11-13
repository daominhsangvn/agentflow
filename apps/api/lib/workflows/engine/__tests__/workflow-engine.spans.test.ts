import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { withSpan } from "@repo/observability/span";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundEvent } from "@/lib/integrations/types";
import {
  createAdvanceDbFake,
  RUN_ID,
} from "@/lib/workflows/__tests__/support/advance-db.test-fake";

const mocks = vi.hoisted(() => ({
  fake: null as ReturnType<typeof createAdvanceDbFake> | null,
  pollDueConnections: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@repo/database", async () => {
  const support = await import(
    "@/lib/workflows/__tests__/support/advance-db.test-fake"
  );
  const db = () => ({
    ...mocks.fake?.db,
    workflowRun: {
      ...mocks.fake?.db.workflowRun,
      findMany: vi.fn().mockResolvedValue([]),
    },
  });
  const withDb = (fn: (db: unknown) => unknown) => fn(db());
  withDb.tx = withDb;
  return { withDb, Prisma: { DbNull: support.PRISMA_DB_NULL } };
});
vi.mock("@/lib/workflows/engine/poll", () => ({
  pollDueConnections: mocks.pollDueConnections,
}));
vi.mock("@/lib/workflows/engine/launch", () => ({
  launchWorkflowLoop: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/launch-step", () => ({
  launchStepLoop: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/actions", () => ({
  enqueueRunEvents: vi.fn(),
  drainActionRuns: vi.fn().mockResolvedValue({
    claimed: 0,
    succeeded: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  }),
  requeueStaleActionRuns: vi.fn().mockResolvedValue(0),
  hasEnabledPreActions: vi.fn(),
  hasPostEvents: vi.fn(),
  skipUnfinishedPreActionRuns: vi.fn(),
  skipPendingPostActionRuns: vi.fn(),
  RUN_CANCELLED_SKIP_REASON: "The run was cancelled.",
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionRuntime: vi.fn(),
  createProviderContext: vi.fn(),
}));
vi.mock("@/app/loops/service", () => ({ loopsService: {} }));
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceDueConversations: vi
    .fn()
    .mockResolvedValue({ advanced: 0, tasksLaunched: 0, waitsFired: 0 }),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));

import { advanceRun } from "../advance";
import { buildRunSource, readRunSource } from "../run-data";
import { runWorkflowTick } from "../tick";

const LINKED_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const LINKED_TRACEPARENT = `00-${LINKED_TRACE_ID}-00f067aa0ba902b7-01`;

describe("workflow engine spans", () => {
  const memory = installInMemorySpans();

  beforeEach(() => {
    memory.reset();
    mocks.fake = createAdvanceDbFake();
    mocks.pollDueConnections.mockReset();
  });
  afterAll(() => {
    memory.uninstall();
  });

  it("stores the active traceparent in the run source", async () => {
    const event = {
      item: {
        provider: IntegrationProviderKey.Jira,
        externalId: "1",
        key: "PROJ-1",
        url: null,
        title: "T",
        container: null,
      },
      inlineItem: null,
      actor: null,
      attributes: {},
      occurredAt: new Date("2026-10-01T00:00:00.000Z"),
    } as unknown as InboundEvent;

    const source = await withSpan("test.root", {}, (span) => {
      const built = buildRunSource(event);
      expect(readRunSource(built)?.traceparent).toContain(
        span.spanContext().traceId
      );
      return built;
    });

    expect(readRunSource(source)?.traceparent).toBeDefined();
  });

  it("links advance_run to the run source's trace and skips on a held lease", async () => {
    mocks.fake?.setRun({ status: WorkflowRunStatus.Received });
    const run = mocks.fake?.state.run;
    if (!run) {
      throw new Error("run expected");
    }
    run.source = {
      ...(run.source as object),
      traceparent: LINKED_TRACEPARENT,
    };
    run.leaseUntil = new Date(Date.now() + 60_000);

    await advanceRun(RUN_ID);

    const span = memory.spans().find((s) => s.name === "workflow.advance_run");
    expect(span?.attributes[AfAttribute.WorkflowRunId]).toBe(RUN_ID);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Skipped);
    expect(span?.links.map((link) => link.traceId)).toEqual([LINKED_TRACE_ID]);
  });

  it("marks workflow.tick.poll as an error when the stage fails", async () => {
    mocks.pollDueConnections.mockRejectedValue(new Error("poll exploded"));

    const result = await runWorkflowTick();

    expect(result.errors[0]).toContain("poll");
    const span = memory.spans().find((s) => s.name === "workflow.tick.poll");
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.attributes[AfAttribute.ErrorReason]).toContain(
      "poll exploded"
    );
  });
});
