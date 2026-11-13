import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { LoopRuntimeState } from "@/app/loops/types";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAuth } from "@/lib/auth/with-auth";
import {
  errorResponse,
  notFoundResponse,
  scheduleLogFlush,
  successResponse,
} from "@/lib/route-utils";
import { loopsService } from "../../service";

export const GET = withAuth<LoopRuntimeState, "/loops/[id]/runtime">(
  async ({ user, clerkOrgId, clerkUserId }, _, params) => {
    try {
      const denied = await denyUnlessPermitted(
        { clerkOrgId, clerkUserId },
        { method: "GET", route: "/loops/[id]/runtime" },
        OrgPermission.UsageReadAll
      );
      if (denied) {
        return denied;
      }

      const { id } = await params;

      const runtime = await loopsService.getLoopRuntime(
        id,
        user.organizationId
      );

      if (!runtime) {
        return notFoundResponse("Loop");
      }

      scheduleLogFlush();
      return successResponse(runtime);
    } catch (error) {
      return errorResponse("Failed to fetch loop runtime", error);
    }
  }
);
