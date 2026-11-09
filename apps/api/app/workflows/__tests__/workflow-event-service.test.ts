import { IntegrationDeliverySource } from "@repo/api/src/types/integration";
import { Status } from "@repo/api/src/types/result";
import { WorkflowEventResult } from "@repo/api/src/types/workflow-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    workflow: { findFirst: vi.fn() },
    workflowEvent: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) => fn(mocks.db),
}));

import { workflowEventService } from "../workflow-event-service";

const ORG = "0199a5f0-0000-7000-8000-000000000001";
const WORKFLOW = "0199a5f0-0000-7000-8000-0000000000f1";
const EVENT = "0199a5f0-0000-7000-8000-0000000000a1";

function row(index: number) {
  return {
    id: `0199a5f0-0000-7000-8000-00000000010${index}`,
    triggerType: "jira.issue_assigned",
    sourceKey: "jira:ABC-1",
    result: WorkflowEventResult.Created,
    runId: null,
    caseId: null,
    detail: null,
    occurredAt: null,
    receivedAt: new Date(`2026-11-0${index + 1}T10:00:00.000Z`),
    delivery: { source: IntegrationDeliverySource.Webhook },
  };
}

describe("workflowEventService.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.workflow.findFirst.mockResolvedValue({ id: WORKFLOW });
    mocks.db.workflowEvent.findMany.mockResolvedValue([]);
  });

  it("scopes by org and workflow, newest first, takes limit + 1", async () => {
    await workflowEventService.list(ORG, WORKFLOW, { limit: 2 });
    expect(mocks.db.workflowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG, workflowId: WORKFLOW },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 3,
      })
    );
  });

  it("returns ISO strings and round-trips nextCursor into the next filter", async () => {
    mocks.db.workflowEvent.findMany.mockResolvedValueOnce([
      row(3),
      row(2),
      row(1),
    ]);
    const first = await workflowEventService.list(ORG, WORKFLOW, { limit: 2 });
    if (!first.ok) {
      throw new Error("expected ok");
    }
    expect(first.value.events).toHaveLength(2);
    expect(first.value.events[0]?.deliveredAt).toBe("2026-11-04T10:00:00.000Z");
    expect(first.value.events[0]?.source).toBe(
      IntegrationDeliverySource.Webhook
    );
    expect(first.value.nextCursor).toBeTruthy();

    await workflowEventService.list(ORG, WORKFLOW, {
      limit: 2,
      cursor: first.value.nextCursor ?? undefined,
    });
    const where = mocks.db.workflowEvent.findMany.mock.calls[1]?.[0].where;
    expect(where.OR).toEqual([
      { receivedAt: { lt: new Date("2026-11-03T10:00:00.000Z") } },
      {
        receivedAt: new Date("2026-11-03T10:00:00.000Z"),
        id: { lt: row(2).id },
      },
    ]);
  });

  it("has no nextCursor on the last page", async () => {
    mocks.db.workflowEvent.findMany.mockResolvedValueOnce([row(1)]);
    const result = await workflowEventService.list(ORG, WORKFLOW, {});
    expect(result.ok && result.value.nextCursor).toBeNull();
  });

  it("skips rows with an unknown result", async () => {
    mocks.db.workflowEvent.findMany.mockResolvedValueOnce([
      { ...row(1), result: "bogus" },
      row(2),
    ]);
    const result = await workflowEventService.list(ORG, WORKFLOW, {});
    expect(result.ok && result.value.events).toHaveLength(1);
  });

  it("rejects an invalid cursor", async () => {
    const result = await workflowEventService.list(ORG, WORKFLOW, {
      cursor: "not-a-cursor",
    });
    expect(result).toEqual({
      ok: false,
      error: { status: Status.BadRequest, message: "Invalid cursor" },
    });
  });

  it("returns not found for an unknown or malformed workflow", async () => {
    mocks.db.workflow.findFirst.mockResolvedValueOnce(null);
    const unknown = await workflowEventService.list(ORG, WORKFLOW, {});
    const malformed = await workflowEventService.list(ORG, "nope", {});
    expect(!unknown.ok && unknown.error.status).toBe(Status.NotFound);
    expect(!malformed.ok && malformed.error.status).toBe(Status.NotFound);
  });
});

describe("workflowEventService.getPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when not found or malformed id", async () => {
    mocks.db.workflowEvent.findFirst.mockResolvedValueOnce(null);
    expect(
      await workflowEventService.getPayload(ORG, WORKFLOW, EVENT)
    ).toBeNull();
    expect(
      await workflowEventService.getPayload(ORG, WORKFLOW, "x")
    ).toBeNull();
  });

  it("returns the payload scoped by org and workflow", async () => {
    mocks.db.workflowEvent.findFirst.mockResolvedValueOnce({
      id: EVENT,
      delivery: {
        source: IntegrationDeliverySource.Poll,
        eventType: "jira.issue_assigned",
        payload: { issue: "ABC-1" },
        receivedAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    });
    const payload = await workflowEventService.getPayload(ORG, WORKFLOW, EVENT);
    expect(mocks.db.workflowEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EVENT, workflowId: WORKFLOW, organizationId: ORG },
      })
    );
    expect(payload).toEqual({
      id: EVENT,
      source: IntegrationDeliverySource.Poll,
      eventType: "jira.issue_assigned",
      deliveredAt: "2026-11-01T10:00:00.000Z",
      payload: { issue: "ABC-1" },
    });
  });

  it("returns payload null when the stored payload is invalid", async () => {
    mocks.db.workflowEvent.findFirst.mockResolvedValueOnce({
      id: EVENT,
      delivery: {
        source: IntegrationDeliverySource.Poll,
        eventType: null,
        payload: undefined,
        receivedAt: new Date(),
      },
    });
    const result = await workflowEventService.getPayload(ORG, WORKFLOW, EVENT);
    expect(result).toMatchObject({ id: EVENT, payload: null });
  });
});
