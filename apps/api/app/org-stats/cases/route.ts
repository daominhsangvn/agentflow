import type { OrgCaseStats } from "@repo/api/src/types/org-stats";
import { orgCaseStatsService } from "@/app/org-stats/case-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/cases. Any org member. */
export const GET = withAnyAuth<OrgCaseStats, "/org-stats/cases">(
  async ({ user }) => {
    try {
      return successResponse(
        await orgCaseStatsService.get(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load case stats", error);
    }
  }
);
