import { IntegrationDeliverySource } from "@repo/api/src/types/integration";
import { Result, Status, type StatusCode } from "@repo/api/src/types/result";
import {
  WORKFLOW_EVENT_LIST_MAX_LIMIT,
  type WorkflowEventPayload,
  type WorkflowEventSummary,
  type WorkflowEventsResponse,
  workflowEventResultSchema,
} from "@repo/api/src/types/workflow-event";
import { type Prisma, withDb } from "@repo/database";
import { z } from "zod";
import { jsonValueSchema } from "@/lib/json-schema";

/**
 * Per-workflow inbound event log (the Events tab). Rows are written by
 * lib/workflows/engine/workflow-events.ts; payloads stay on the delivery and
 * are served separately to org admins.
 */

const DEFAULT_LIMIT = 50;

type EventServiceError = { status: StatusCode; message: string };
type EventCursor = { receivedAt: Date; id: string };

const uuidSchema = z.uuid();
const cursorSchema = z.object({ r: z.iso.datetime(), i: z.uuid() });
const sourceSchema = z.enum(IntegrationDeliverySource);

const EVENT_SELECT = {
  id: true,
  triggerType: true,
  sourceKey: true,
  result: true,
  runId: true,
  caseId: true,
  detail: true,
  occurredAt: true,
  receivedAt: true,
  delivery: { select: { source: true } },
} satisfies Prisma.WorkflowEventSelect;

type EventRow = Prisma.WorkflowEventGetPayload<{
  select: typeof EVENT_SELECT;
}>;

export const workflowEventService = {
  async list(
    organizationId: string,
    workflowId: string,
    options: { cursor?: string; limit?: number }
  ): Promise<Result<WorkflowEventsResponse, EventServiceError>> {
    if (!uuidSchema.safeParse(workflowId).success) {
      return notFound();
    }
    const cursor = options.cursor ? decodeCursor(options.cursor) : undefined;
    if (cursor === null) {
      return Result.err({
        status: Status.BadRequest,
        message: "Invalid cursor",
      });
    }
    const workflow = await withDb((db) =>
      db.workflow.findFirst({
        where: { id: workflowId, organizationId },
        select: { id: true },
      })
    );
    if (!workflow) {
      return notFound();
    }
    const limit = clampLimit(options.limit);
    const rows = await withDb((db) =>
      db.workflowEvent.findMany({
        where: {
          organizationId,
          workflowId,
          ...(cursor ? cursorFilter(cursor) : {}),
        },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: EVENT_SELECT,
      })
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return Result.ok({
      events: page.flatMap((row) => {
        const summary = toSummary(row);
        return summary ? [summary] : [];
      }),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    });
  },

  async getPayload(
    organizationId: string,
    workflowId: string,
    eventId: string
  ): Promise<WorkflowEventPayload | null> {
    if (
      !(
        uuidSchema.safeParse(workflowId).success &&
        uuidSchema.safeParse(eventId).success
      )
    ) {
      return null;
    }
    const row = await withDb((db) =>
      db.workflowEvent.findFirst({
        where: { id: eventId, workflowId, organizationId },
        select: {
          id: true,
          delivery: {
            select: {
              source: true,
              eventType: true,
              payload: true,
              receivedAt: true,
            },
          },
        },
      })
    );
    if (!row) {
      return null;
    }
    const source = sourceSchema.safeParse(row.delivery.source);
    const payload = jsonValueSchema.safeParse(row.delivery.payload);
    if (!source.success) {
      return null;
    }
    return {
      id: row.id,
      source: source.data,
      eventType: row.delivery.eventType,
      deliveredAt: row.delivery.receivedAt.toISOString(),
      payload: payload.success ? payload.data : null,
    };
  },
};

function notFound(): Result<never, EventServiceError> {
  return Result.err({
    status: Status.NotFound,
    message: "Workflow not found",
  });
}

function toSummary(row: EventRow): WorkflowEventSummary | null {
  const result = workflowEventResultSchema.safeParse(row.result);
  const source = sourceSchema.safeParse(row.delivery.source);
  if (!(result.success && source.success)) {
    return null;
  }
  return {
    id: row.id,
    source: source.data,
    triggerType: row.triggerType,
    sourceKey: row.sourceKey,
    result: result.data,
    runId: row.runId,
    caseId: row.caseId,
    detail: row.detail,
    occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
    deliveredAt: row.receivedAt.toISOString(),
  };
}

function cursorFilter(cursor: EventCursor): Prisma.WorkflowEventWhereInput {
  return {
    OR: [
      { receivedAt: { lt: cursor.receivedAt } },
      { receivedAt: cursor.receivedAt, id: { lt: cursor.id } },
    ],
  };
}

function encodeCursor(row: { receivedAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ r: row.receivedAt.toISOString(), i: row.id }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(cursor: string): EventCursor | null {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    const parsed = cursorSchema.safeParse(decoded);
    return parsed.success
      ? { receivedAt: new Date(parsed.data.r), id: parsed.data.i }
      : null;
  } catch {
    return null;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(
    Math.max(1, Math.trunc(limit)),
    WORKFLOW_EVENT_LIST_MAX_LIMIT
  );
}
