import {
  type OrchestratorCaseListSummary,
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
 * GET /orchestrator/cases/summary?projectId=&workflowId=&status=
 * Case counts for the same filters as the case list. Any org member.
 */
export const GET = withAnyAuth<
  OrchestratorCaseListSummary,
  "/orchestrator/cases/summary"
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
      await orchestratorCaseService.summaryForOrg(user.organizationId, query)
    );
  } catch (error) {
    return errorResponse("Failed to summarize orchestrator cases", error);
  }
});
