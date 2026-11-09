import {
  IntegrationDeliveryOutcome,
  IntegrationDeliverySource,
} from "@repo/api/src/types/integration";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { WorkflowEventResult } from "@repo/api/src/types/workflow-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEvent,
  buildLoadedConnection,
  createIngestDbFake,
  type IngestDbFake,
  TRIGGER_ID,
  WORKFLOW_ID,
} from "@/lib/workflows/__tests__/support/ingest-db.test-fake";
import {
  type IngestEventsInput,
  ingestEvents,
} from "@/lib/workflows/engine/ingest";

const mocks = vi.hoisted(() => ({
  fake: null as IngestDbFake | null,
  findRepliedRuns: vi.fn(),
  routeReviewSignals: vi.fn(),
  routeToOrchestrator: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const withDb = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  withDb.tx = (fn: (db: unknown) => unknown) => fn(mocks.fake?.db);
  return { withDb, Prisma: { DbNull: "__db_null__" } };
});
vi.mock("@/lib/integrations/registry", async () => {
  const support = await import(
    "@/lib/workflows/__tests__/support/ingest-db.test-fake"
  );
  return {
    findTriggerDefinition: (_provider: string, type: string) =>
      type === support.TRIGGER_TYPE ? support.fakeTriggerDefinition : null,
  };
});
vi.mock("@/lib/workflows/engine/advance", () => ({
  advanceRun: vi.fn(() => Promise.resolve("advanced")),
}));
vi.mock("@/lib/workflows/engine/actions", () => ({
  hasEnabledPreActions: vi.fn(() => Promise.resolve(false)),
  enqueueRunEvents: vi.fn(() => Promise.resolve(1)),
}));
vi.mock("@/lib/workflows/engine/answer-replies", () => ({
  findRepliedRuns: mocks.findRepliedRuns,
}));
vi.mock("@/lib/workflows/engine/review-signals", () => ({
  routeReviewSignals: mocks.routeReviewSignals,
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/orchestrator/inbound", () => ({
  routeToOrchestrator: mocks.routeToOrchestrator,
}));

let fake: IngestDbFake;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createIngestDbFake();
  mocks.fake = fake;
  mocks.findRepliedRuns.mockResolvedValue([]);
  mocks.routeReviewSignals.mockResolvedValue([]);
  mocks.routeToOrchestrator.mockResolvedValue([]);
  fake.addWorkflow();
  fake.addTrigger();
  fake.addScope("PROJ");
});

function input(overrides: Partial<IngestEventsInput> = {}): IngestEventsInput {
  return {
    connection: buildLoadedConnection(),
    source: IntegrationDeliverySource.Webhook,
    deliveryId: "delivery-1",
    eventType: "jira:issue_updated",
    events: [buildEvent()],
    payload: { webhookEvent: "jira:issue_updated" },
    ...overrides,
  };
}

const OTHER_PROJECT = buildEvent({ attributes: { projectKey: "OTHER" } });

describe("ingestEvents workflow events", () => {
  it("records a created run with its delivery, trigger and item", async () => {
    const result = await ingestEvents(input());

    expect(fake.workflowEvents).toHaveLength(1);
    expect(fake.workflowEvents[0]).toMatchObject({
      deliveryId: result.deliveryRowId,
      workflowId: WORKFLOW_ID,
      triggerId: TRIGGER_ID,
      result: WorkflowEventResult.Created,
      runId: "run-1",
      sourceKey: "jira:PROJ-7",
      occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    });
  });

  it("records a resumed run", async () => {
    fake.addRun({ status: WorkflowRunStatus.NeedsInput });

    await ingestEvents(
      input({ events: [buildEvent({ dedupKey: "PROJ-7:assignee:200" })] })
    );

    expect(fake.workflowEvents[0]?.result).toBe(WorkflowEventResult.Resumed);
  });

  it("records an occurrence the workflow already handled as a duplicate", async () => {
    fake.addRun({
      status: WorkflowRunStatus.Succeeded,
      dedupKey: "PROJ-7:assignee:100",
    });

    await ingestEvents(input());

    expect(fake.workflowEvents[0]).toMatchObject({
      result: WorkflowEventResult.Duplicate,
      detail: "Occurrence already handled",
    });
  });

  it("records an active run for the item", async () => {
    fake.addRun({ status: WorkflowRunStatus.Planning });

    await ingestEvents(input());

    expect(fake.workflowEvents[0]?.result).toBe(WorkflowEventResult.Active);
  });

  it("records a review signal once, not as a trigger too", async () => {
    const run = fake.addRun({ status: WorkflowRunStatus.NeedsInput });
    mocks.routeReviewSignals.mockResolvedValue([
      { runId: run.id, workflowId: WORKFLOW_ID },
    ]);

    await ingestEvents(input());

    expect(fake.workflowEvents).toHaveLength(1);
    expect(fake.workflowEvents[0]).toMatchObject({
      result: WorkflowEventResult.Signaled,
      runId: run.id,
      triggerId: null,
    });
  });

  it("records a reply that resumed a run, even when no trigger matched", async () => {
    const run = fake.addRun({ status: WorkflowRunStatus.NeedsInput });
    mocks.findRepliedRuns.mockResolvedValue([
      { runId: run.id, workflowId: WORKFLOW_ID },
    ]);

    await ingestEvents(input({ events: [OTHER_PROJECT] }));

    expect(fake.workflowEvents).toHaveLength(1);
    expect(fake.workflowEvents[0]).toMatchObject({
      result: WorkflowEventResult.Replied,
      runId: run.id,
    });
  });

  it("records a case message, and a duplicate for a message already recorded", async () => {
    fake.addWorkflow({
      agentConfig: {
        computeTargetId: "ct-1",
        mode: WorkflowAgentMode.Orchestrated,
      },
    });
    mocks.routeToOrchestrator.mockResolvedValue([
      {
        conversationId: "conversation-1",
        caseId: "case-1",
        workflowId: WORKFLOW_ID,
        created: true,
      },
    ]);
    await ingestEvents(input());
    mocks.routeToOrchestrator.mockResolvedValue([
      {
        conversationId: "conversation-1",
        caseId: "case-1",
        workflowId: WORKFLOW_ID,
        created: false,
      },
    ]);
    await ingestEvents(input({ deliveryId: "delivery-2" }));

    expect(fake.workflowEvents).toMatchObject([
      {
        result: WorkflowEventResult.CaseMessage,
        caseId: "case-1",
        runId: null,
        triggerId: TRIGGER_ID,
      },
      {
        result: WorkflowEventResult.Duplicate,
        caseId: "case-1",
        detail: "Message already recorded",
      },
    ]);
  });

  it("records a filtered event when the trigger did not match", async () => {
    await ingestEvents(input({ events: [OTHER_PROJECT] }));

    expect(fake.workflowEvents).toHaveLength(1);
    expect(fake.workflowEvents[0]).toMatchObject({
      result: WorkflowEventResult.Filtered,
      triggerId: TRIGGER_ID,
      runId: null,
    });
  });

  it("records nothing for an event type no trigger listens to", async () => {
    await ingestEvents(
      input({ events: [buildEvent({ triggerType: "fake.other" })] })
    );

    expect(fake.workflowEvents).toEqual([]);
  });

  it("records nothing for a duplicate delivery", async () => {
    await ingestEvents(input());
    fake.workflowEvents.length = 0;

    const second = await ingestEvents(input());

    expect(second.outcome).toBe(IntegrationDeliveryOutcome.Duplicate);
    expect(fake.workflowEvents).toEqual([]);
  });

  it("records a manual run as created", async () => {
    await ingestEvents(
      input({
        source: IntegrationDeliverySource.Manual,
        deliveryId: "manual:1",
        manualTriggerId: TRIGGER_ID,
        events: [OTHER_PROJECT],
      })
    );

    expect(fake.workflowEvents[0]).toMatchObject({
      result: WorkflowEventResult.Created,
      triggerId: TRIGGER_ID,
    });
  });

  it("still accepts the delivery when recording fails", async () => {
    fake.failEventRecording(new Error("db down"));

    const result = await ingestEvents(input());

    expect(result.outcome).toBe(IntegrationDeliveryOutcome.Accepted);
    expect(fake.runs).toHaveLength(1);
  });
});
