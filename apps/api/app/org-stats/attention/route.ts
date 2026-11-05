import type { OrgAttentionStats } from "@repo/api/src/types/org-stats";
import { attentionStatsService } from "@/app/org-stats/attention-stats-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/** GET /org-stats/attention. Any org member. */
export const GET = withAnyAuth<OrgAttentionStats, "/org-stats/attention">(
  async ({ user }) => {
    try {
      return successResponse(
        await attentionStatsService.get(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to load attention stats", error);
    }
  }
);
