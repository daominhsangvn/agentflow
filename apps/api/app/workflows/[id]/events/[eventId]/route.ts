import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { WorkflowEventPayload } from "@repo/api/src/types/workflow-event";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  notFoundResponse,
  successResponse,
} from "@/lib/route-utils";
import { denyUnlessWorkflowPermission } from "../../../route-helpers";
import { workflowEventService } from "../../../workflow-event-service";

const ROUTE = "/workflows/[id]/events/[eventId]";

/**
 * GET /workflows/{id}/events/{eventId}
 * The stored delivery payload behind one event (may contain customer data).
 * Org admins only.
 */
export const GET = withAnyAuth<
  WorkflowEventPayload,
  "/workflows/[id]/events/[eventId]"
>(async (auth, request, params) => {
  try {
    const denied = await denyUnlessWorkflowPermission(
      auth,
      {
        method: request.method,
        route: ROUTE,
      },
      OrgPermission.WorkflowManage
    );
    if (denied) {
      return denied;
    }
    const { id, eventId } = await params;
    const payload = await workflowEventService.getPayload(
      auth.user.organizationId,
      id,
      eventId
    );
    if (!payload) {
      return notFoundResponse("Workflow event");
    }
    return successResponse(payload);
  } catch (error) {
    return errorResponse("Failed to load workflow event", error);
  }
});
