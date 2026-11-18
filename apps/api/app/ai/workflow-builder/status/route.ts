import "server-only";

import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { WorkflowBuilderStatus } from "@repo/api/src/types/workflow-builder";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { successResponse } from "@/lib/route-utils";
import { workflowBuilderService } from "../service";

const ROUTE = "/ai/workflow-builder/status";

/**
 * GET /ai/workflow-builder/status
 *
 * Whether the opt-in workflow builder agent is configured. Requires WorkflowManage.
 */
export const GET = withAnyAuth<WorkflowBuilderStatus, typeof ROUTE>(
  async (auth, request) => {
    const denied = await denyUnlessPermitted(
      auth,
      { method: request.method, route: ROUTE },
      OrgPermission.WorkflowManage
    );
    if (denied) {
      return denied;
    }
    return successResponse(await workflowBuilderService.getStatus());
  }
);
