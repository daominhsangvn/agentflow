import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { ComputeModeResponse } from "@repo/api/src/types/settings";
import { z } from "zod";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAuth } from "@/lib/auth/with-auth";
import { errorResponse, parseBody, successResponse } from "@/lib/route-utils";
import { computeModeService } from "../compute-mode-service";

const computeModeValidator = z.object({
  computeMode: z.enum(["GITHUB_ACTIONS", "LOOPS"]),
});

/**
 * GET /settings/compute-mode
 * Returns the organization's current compute mode.
 */
export const GET = withAuth<ComputeModeResponse, "/settings/compute-mode">(
  async ({ user }) => {
    try {
      const computeMode = await computeModeService.getComputeMode(
        user.organizationId
      );
      return successResponse({ computeMode });
    } catch (error) {
      return errorResponse("Failed to fetch compute mode", error);
    }
  }
);

/**
 * PUT /settings/compute-mode
 * Set the organization's compute mode. Requires admin role.
 */
export const PUT = withAuth<ComputeModeResponse, "/settings/compute-mode">(
  async ({ user, clerkOrgId, clerkUserId }, request) => {
    try {
      const denied = await denyUnlessPermitted(
        { clerkOrgId, clerkUserId },
        { method: "PUT", route: "/settings/compute-mode" },
        OrgPermission.OrganizationUpdate
      );
      if (denied) {
        return denied;
      }

      const { body, errorResponse: parseError } = await parseBody(
        request,
        computeModeValidator
      );
      if (parseError || !body) {
        return parseError;
      }

      await computeModeService.setComputeMode(
        user.organizationId,
        body.computeMode
      );
      return successResponse({ computeMode: body.computeMode });
    } catch (error) {
      return errorResponse("Failed to set compute mode", error);
    }
  }
);
