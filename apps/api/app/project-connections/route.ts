import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { ProjectConnectionsResponse } from "@repo/api/src/types/project-connection";
import { projectConnectionService } from "@/app/projects/project-connection-service";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { errorResponse, successResponse } from "@/lib/route-utils";

const ROUTE = "/project-connections";

/**
 * GET /project-connections
 * Every project connection of the organization, for the workflow editor
 * (connection keys per project). Org admins only.
 */
export const GET = withAnyAuth<
  ProjectConnectionsResponse,
  "/project-connections"
>(async (auth, request) => {
  try {
    const denied = await denyUnlessPermitted(
      auth,
      { method: request.method, route: ROUTE },
      OrgPermission.ProjectManage
    );
    if (denied) {
      return denied;
    }
    const connections = await projectConnectionService.listAll(
      auth.user.organizationId
    );
    return successResponse({ connections });
  } catch (error) {
    return errorResponse("Failed to list project connections", error);
  }
});
