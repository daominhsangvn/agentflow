import type { OrgUsageStats } from "@repo/api/src/types/org-stats";
import { orgUsageStatsService } from "@/app/org-stats/usage-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/usage. Any org member. */
export const GET = withAnyAuth<OrgUsageStats, "/org-stats/usage">(
  async ({ user }) => {
    try {
      return successResponse(
        await orgUsageStatsService.get(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load usage stats", error);
    }
  }
);
