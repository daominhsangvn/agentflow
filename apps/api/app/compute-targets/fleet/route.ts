import type { AgentFleetResponse } from "@repo/api/src/types/agent-fleet";
import { computeTargetFleetService } from "@/app/compute-targets/fleet-service";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

/**
 * GET /compute-targets/fleet
 * Every agent (compute target) of the organization with its health, Claude Code
 * version, projects and commands. Any org member sees all of them, personal
 * agents included. (A static segment wins over `[id]` in the App Router.)
 */
export const GET = withAnyAuth<AgentFleetResponse, "/compute-targets/fleet">(
  async ({ user }) => {
    try {
      return successResponse(
        await computeTargetFleetService.list(user.organizationId)
      );
    } catch (error) {
      return errorResponse("Failed to list agents", error);
    }
  }
);
