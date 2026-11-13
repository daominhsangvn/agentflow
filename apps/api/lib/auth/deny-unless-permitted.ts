import type { ApiResult } from "@repo/api/src/types/common";
import type { OrgPermission } from "@repo/api/src/types/org-permissions";
import { log } from "@repo/observability/log";
import type { NextResponse } from "next/server";
import { getOrgPermissionStatus } from "@/lib/auth/org-permissions";
import type { AuthContext } from "@/lib/auth/with-auth";
import { forbiddenResponse, scheduleLogFlush } from "@/lib/route-utils";

/**
 * Returns a 403 response when the caller lacks `permission` in the org, or
 * null when permitted. Resolved from the database on every call, never from
 * the JWT claim.
 */
export async function denyUnlessPermitted(
  auth: Pick<AuthContext, "clerkOrgId" | "clerkUserId">,
  request: { method: string; route: string },
  permission: OrgPermission
): Promise<NextResponse<ApiResult<never>> | null> {
  const status = await getOrgPermissionStatus(
    auth.clerkOrgId,
    auth.clerkUserId
  );
  if (
    status.kind === "member" &&
    (status.isOwner || status.permissions.has(permission))
  ) {
    return null;
  }
  log.warn("Denied request for user without the required permission", {
    clerkOrgId: auth.clerkOrgId,
    clerkUserId: auth.clerkUserId,
    permission,
    reason: status.kind === "member" ? "missing_permission" : status.kind,
    method: request.method,
    route: request.route,
  });
  scheduleLogFlush();
  return forbiddenResponse();
}
