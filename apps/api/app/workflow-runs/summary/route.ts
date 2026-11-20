import type { WorkflowRunsSummary } from "@repo/api/src/types/workflow";
import {
  orgRunSummaryQuerySchema,
  serviceErrorResponse,
} from "@/app/workflows/route-helpers";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  parseQueryParams,
  successResponse,
} from "@/lib/route-utils";
import { workflowRunService } from "@/lib/workflows/run-service";

/**
 * GET /workflow-runs/summary?status=&projectId=&workflowId=&startDate=&endDate=
 * Run counts per bucket for the same filters as the run list. Any org member.
 */
export const GET = withAnyAuth<WorkflowRunsSummary, "/workflow-runs/summary">(
  async ({ user }, request) => {
    try {
      const { params: query, errorResponse: queryError } = parseQueryParams(
        request,
        orgRunSummaryQuerySchema
      );
      if (queryError) {
        return queryError;
      }
      const result = await workflowRunService.summary(
        user.organizationId,
        query
      );
      if (!result.ok) {
        return serviceErrorResponse(result.error);
      }
      return successResponse(result.value);
    } catch (error) {
      return errorResponse("Failed to summarize workflow runs", error);
    }
  }
);
