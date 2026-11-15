import {
  WorkflowActionRunStatus,
  WorkflowRunEvent,
  WorkflowRunStatus,
} from "@repo/api/src/types/workflow";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorkflowRunSnapshot } from "@/lib/integrations/types";
import {
  type ActionRunsDbFake,
  createActionRunsDbFake,
} from "@/lib/workflows/__tests__/support/action-runs-db.test-fake";
import { drainActionRuns } from "@/lib/workflows/engine/actions";

const mocks = vi.hoisted(() => ({
  fake: null as ActionRunsDbFake | null,
  execute: vi.fn(),
  loadConnectionRuntime: vi.fn(),
  buildRunSnapshot: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (client: unknown) => unknown) => fn(mocks.fake?.db),
  Prisma: { DbNull: null },
}));
vi.mock("@/lib/workflows/engine/instruction-action", () => ({
  startInstruction: vi.fn(),
  readInstructionProgress: vi.fn(),
  summarizeInstruction: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/email-action", () => ({
  executeEmailAction: vi.fn(),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionRuntime: mocks.loadConnectionRuntime,
  createProviderContext: (runtime: unknown) => ({
    connection: runtime,
    http: {},
    log: {},
    now: () => new Date(),
  }),
}));
vi.mock("@/lib/integrations/registry", () => ({
  findActionDefinition: () => ({
    key: "fake.add_comment",
    configSchema: z.object({ message: z.string().min(1) }),
    execute: mocks.execute,
  }),
}));
vi.mock("@/lib/workflows/engine/snapshot", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/workflows/engine/snapshot")>();
  return { ...original, buildRunSnapshot: mocks.buildRunSnapshot };
});
vi.mock("@/lib/workflows/engine/run-repository", () => ({
  recordActionOutputs: vi.fn(),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));

const ACTION_TYPE = "fake.add_comment";
const ORG_ID = "org-1";
const RUN_ID = "run-1";
const NOW = new Date("2026-10-01T12:00:00.000Z");

describe("workflow.action_run span", () => {
  const memory = installInMemorySpans();

  beforeEach(() => {
    memory.reset();
    vi.clearAllMocks();
    const fake = createActionRunsDbFake();
    mocks.fake = fake;
    fake.addAction({
      id: "action-1",
      type: ACTION_TYPE,
      config: { message: "hi" },
      events: [WorkflowRunEvent.Succeeded],
    });
    mocks.loadConnectionRuntime.mockResolvedValue({
      record: { id: "conn-1", name: "Tracker", status: "active" },
      provider: { key: "fake", displayName: "Fake" },
      runtime: { id: "conn-1", secrets: {}, config: {} },
    });
    mocks.buildRunSnapshot.mockResolvedValue({
      id: RUN_ID,
      status: WorkflowRunStatus.Succeeded,
      event: WorkflowRunEvent.Succeeded,
      source: { provider: "fake", externalId: "1", key: "P-1", title: "T" },
      sourceExtras: {},
      pullRequests: [],
      repositories: [],
      documents: [],
      stepReplies: {},
    } as unknown as WorkflowRunSnapshot);
    fake.addActionRun({
      organizationId: ORG_ID,
      runId: RUN_ID,
      actionId: "action-1",
      actionType: ACTION_TYPE,
      nextAttemptAt: new Date(NOW.getTime() - 1000),
    });
  });
  afterAll(() => {
    memory.uninstall();
  });

  function actionRunSpan() {
    return memory.spans().find((span) => span.name === "workflow.action_run");
  }

  it("records a retryable failure as retry without an error status", async () => {
    mocks.execute.mockResolvedValue({
      status: WorkflowActionRunStatus.Failed,
      error: "HTTP 503",
      retryable: true,
    });

    await drainActionRuns({ now: NOW });

    const span = actionRunSpan();
    expect(span?.attributes[AfAttribute.OrgId]).toBe(ORG_ID);
    expect(span?.attributes[AfAttribute.WorkflowRunId]).toBe(RUN_ID);
    expect(span?.attributes["af.workflow.action"]).toBe(ACTION_TYPE);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Retry);
    expect(span?.status.code).not.toBe(TestSpanStatus.Error);
  });

  it("marks a permanent failure as an error", async () => {
    mocks.execute.mockResolvedValue({
      status: WorkflowActionRunStatus.Failed,
      error: "boom",
      retryable: false,
    });

    await drainActionRuns({ now: NOW });

    const span = actionRunSpan();
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.attributes[AfAttribute.ErrorReason]).toContain("boom");
  });
});
