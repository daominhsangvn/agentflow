import {
  type OrchestratorCaseDetail,
  type UpdateOrchestratorCaseInput,
  updateOrchestratorCaseInputSchema,
} from "@repo/api/src/types/orchestrator";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { Status } from "@repo/api/src/types/result";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  conflictResponse,
  deleteResponse,
  errorResponse,
  notFoundResponse,
  parseBody,
  successResponse,
} from "@/lib/route-utils";

const ROUTE = "/orchestrator/cases/[id]";
const BODY_MAX_BYTES = 4096;
const CASE_ACTIVE_MESSAGE =
  "The case has a running turn or task. Stop it before deleting the case.";

/**
 * GET /orchestrator/cases/{id}
 * A case with its conversations, turns, tasks, waits and decisions. Any org
 * member.
 */
export const GET = withAnyAuth<
  OrchestratorCaseDetail,
  "/orchestrator/cases/[id]"
>(async ({ user }, _request, params) => {
  try {
    const { id } = await params;
    const found = await orchestratorCaseService.get(user.organizationId, id);
    return found ? successResponse(found) : notFoundResponse("Case");
  } catch (error) {
    return errorResponse("Failed to read the orchestrator case", error);
  }
});

/**
 * PATCH /orchestrator/cases/{id}
 * Closes or reopens a case (`{ status }`). Org admins only.
 */
export const PATCH = withAnyAuth<
  { status: UpdateOrchestratorCaseInput["status"] },
  "/orchestrator/cases/[id]"
>(async (auth, request, params) => {
  try {
    const denied = await denyUnlessPermitted(
      auth,
      { method: request.method, route: ROUTE },
      OrgPermission.OrchestratorOperate
    );
    if (denied) {
      return denied;
    }
    const { id } = await params;
    const { body, errorResponse: invalid } = await parseBody(
      request,
      updateOrchestratorCaseInputSchema,
      { maxBytes: BODY_MAX_BYTES }
    );
    if (invalid || !body) {
      return invalid;
    }
    const result = await orchestratorCaseService.setStatus(
      auth.user.organizationId,
      id,
      body
    );
    if (result.ok) {
      return successResponse(result.value);
    }
    return notFoundResponse("Case");
  } catch (error) {
    return errorResponse("Failed to update the orchestrator case", error);
  }
});

/**
 * DELETE /orchestrator/cases/{id}
 * Deletes a case with its conversations, tasks, waits and decisions. Org
 * admins only; 409 while a turn runs or a task is queued or running.
 */
export const DELETE = withAnyAuth<
  { deleted: true },
  "/orchestrator/cases/[id]"
>(async (auth, request, params) => {
  try {
    const denied = await denyUnlessPermitted(
      auth,
      { method: request.method, route: ROUTE },
      OrgPermission.OrchestratorOperate
    );
    if (denied) {
      return denied;
    }
    const { id } = await params;
    const result = await orchestratorCaseService.remove(
      auth.user.organizationId,
      id
    );
    if (result.ok) {
      return deleteResponse();
    }
    if (result.error === Status.Conflict) {
      return conflictResponse(CASE_ACTIVE_MESSAGE);
    }
    return notFoundResponse("Case");
  } catch (error) {
    return errorResponse("Failed to delete the orchestrator case", error);
  }
});
