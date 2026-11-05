import type { OrgWorkflowStats } from "@repo/api/src/types/org-stats";
import { overviewStatsService } from "@/app/org-stats/overview-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/workflows. Any org member. */
export const GET = withAnyAuth<OrgWorkflowStats, "/org-stats/workflows">(
  async ({ user }) => {
    try {
      return successResponse(
        await overviewStatsService.workflows(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load workflows stats", error);
    }
  }
);
