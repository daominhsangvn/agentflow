import type { OrgActivityStats } from "@repo/api/src/types/org-stats";
import { orgActivityStatsService } from "@/app/org-stats/activity-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/activity. Any org member. */
export const GET = withAnyAuth<OrgActivityStats, "/org-stats/activity">(
  async ({ user }) => {
    try {
      return successResponse(
        await orgActivityStatsService.get(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load activity stats", error);
    }
  }
);
