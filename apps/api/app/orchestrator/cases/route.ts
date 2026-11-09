import {
  type OrchestratorCaseListItem,
  orchestratorCaseListQuerySchema,
} from "@repo/api/src/types/orchestrator";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  parseQueryParams,
  successResponse,
} from "@/lib/route-utils";

/**
 * GET /orchestrator/cases?projectId=&workflowId=&status=
 * The 100 most recently updated cases of the organization. Any org member.
 */
export const GET = withAnyAuth<
  OrchestratorCaseListItem[],
  "/orchestrator/cases"
>(async ({ user }, request) => {
  try {
    const { params: query, errorResponse: queryError } = parseQueryParams(
      request,
      orchestratorCaseListQuerySchema
    );
    if (queryError) {
      return queryError;
    }
    return successResponse(
      await orchestratorCaseService.listForOrg(user.organizationId, query)
    );
  } catch (error) {
    return errorResponse("Failed to list orchestrator cases", error);
  }
});
