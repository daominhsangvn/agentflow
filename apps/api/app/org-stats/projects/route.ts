import type { OrgProjectStats } from "@repo/api/src/types/org-stats";
import { overviewStatsService } from "@/app/org-stats/overview-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/projects. Any org member. */
export const GET = withAnyAuth<OrgProjectStats, "/org-stats/projects">(
  async ({ user }) => {
    try {
      return successResponse(
        await overviewStatsService.projects(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load projects stats", error);
    }
  }
);
