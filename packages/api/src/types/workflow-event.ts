import { z } from "zod";
import type { JsonValue } from "./common";
import type { IntegrationDeliverySource } from "./integration.ts";

/** What ingest did with an inbound event for one workflow (docs/workflows.md "Ingest"). */
export const WorkflowEventResult = {
  Created: "created",
  Resumed: "resumed",
  Duplicate: "duplicate",
  Active: "active",
  Signaled: "signaled",
  Replied: "replied",
  CaseMessage: "case_message",
  Filtered: "filtered",
} as const;
export type WorkflowEventResult =
  (typeof WorkflowEventResult)[keyof typeof WorkflowEventResult];
export const workflowEventResultSchema = z.enum(WorkflowEventResult);
export const WORKFLOW_EVENT_LIST_MAX_LIMIT = 100;

export type WorkflowEventSummary = {
  id: string;
  source: IntegrationDeliverySource;
  triggerType: string;
  sourceKey: string | null;
  result: WorkflowEventResult;
  runId: string | null;
  caseId: string | null;
  detail: string | null;
  /** ISO; when the source system says the change happened. */
  occurredAt: string | null;
  /** ISO; when AgentFlow received the delivery (row receivedAt; named outside the date-revival allowlist). */
  deliveredAt: string;
};

export type WorkflowEventsResponse = {
  events: WorkflowEventSummary[];
  nextCursor: string | null;
};

/** GET /workflows/{id}/events/{eventId} — org admins only. */
export type WorkflowEventPayload = {
  id: string;
  source: IntegrationDeliverySource;
  eventType: string | null;
  deliveredAt: string;
  /** The delivery's troubleshooting copy (may be { truncated, preview }); null when none was kept. */
  payload: JsonValue | null;
};
