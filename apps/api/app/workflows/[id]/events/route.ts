import type { WorkflowEventsResponse } from "@repo/api/src/types/workflow-event";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  parseQueryParams,
  successResponse,
} from "@/lib/route-utils";
import {
  eventListQuerySchema,
  serviceErrorResponse,
} from "../../route-helpers";
import { workflowEventService } from "../../workflow-event-service";

/**
 * GET /workflows/{id}/events?cursor=&limit=
 * Inbound event log of one workflow, newest first. Any org member.
 */
export const GET = withAnyAuth<
  WorkflowEventsResponse,
  "/workflows/[id]/events"
>(async ({ user }, request, params) => {
  try {
    const { params: query, errorResponse: queryError } = parseQueryParams(
      request,
      eventListQuerySchema
    );
    if (queryError) {
      return queryError;
    }
    const { id } = await params;
    const result = await workflowEventService.list(
      user.organizationId,
      id,
      query
    );
    if (!result.ok) {
      return serviceErrorResponse(result.error);
    }
    return successResponse(result.value);
  } catch (error) {
    return errorResponse("Failed to list workflow events", error);
  }
});
