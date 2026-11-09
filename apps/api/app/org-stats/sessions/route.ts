import type { OrgSessionStats } from "@repo/api/src/types/org-stats";
import { overviewStatsService } from "@/app/org-stats/overview-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/sessions. Any org member. */
export const GET = withAnyAuth<OrgSessionStats, "/org-stats/sessions">(
  async ({ user }) => {
    try {
      return successResponse(
        await overviewStatsService.sessions(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load sessions stats", error);
    }
  }
);
