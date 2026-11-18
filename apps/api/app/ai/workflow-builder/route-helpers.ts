import { ApiKeyScope } from "@repo/api/src/types/api-key";
import { failure } from "@repo/api/src/types/common";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { log } from "@repo/observability/log";
import { NextResponse } from "next/server";
import { organizationsService } from "@/app/organizations/service";
import { usersService } from "@/app/users/service";
import { authContextFailureResponse } from "@/lib/auth/auth-context-failure";
import { getOrgPermissionStatus } from "@/lib/auth/org-permissions";
import { resolveAnyAuthContext } from "@/lib/auth/resolve-any-auth-context";
import {
  errorResponse,
  forbiddenResponse,
  scheduleLogFlush,
  unauthorizedResponse,
} from "@/lib/route-utils";
import type { WorkflowBuilderChatFailure } from "./service";
import type { WorkflowBuilderCaller } from "./service/catalog-tool";

export type WorkflowBuilderAuthorization =
  | { ok: true; caller: WorkflowBuilderCaller }
  | { ok: false; response: Response };

export async function authorizeWorkflowBuilderChat(
  request: Request
): Promise<WorkflowBuilderAuthorization> {
  try {
    return await authorize(request);
  } catch (error) {
    return {
      ok: false,
      response: errorResponse("Workflow builder authorization failed", error),
    };
  }
}

export function toChatFailureResponse(
  chatFailure: WorkflowBuilderChatFailure
): Response {
  const response = NextResponse.json(
    failure(
      chatFailure.message,
      chatFailure.code ? { code: chatFailure.code } : undefined
    ),
    { status: chatFailure.status }
  );
  if (chatFailure.retryAfterSeconds !== undefined) {
    response.headers.set("Retry-After", String(chatFailure.retryAfterSeconds));
  }
  return response;
}

async function authorize(
  request: Request
): Promise<WorkflowBuilderAuthorization> {
  const resolved = await resolveAnyAuthContext(request, {
    requiredScopes: [ApiKeyScope.Write],
  });
  if (!resolved.ok) {
    return {
      ok: false,
      response: authContextFailureResponse(resolved.failure),
    };
  }
  const { organizationId, userId } = resolved.context;
  const [user, organization] = await Promise.all([
    usersService.findById(userId, organizationId),
    organizationsService.findById(organizationId),
  ]);
  if (!(user && organization)) {
    return { ok: false, response: unauthorizedResponse() };
  }

  const status = await getOrgPermissionStatus(
    organization.clerkId,
    user.clerkId
  );
  const permitted =
    status.kind === "member" &&
    (status.isOwner || status.permissions.has(OrgPermission.WorkflowManage));
  if (status.kind !== "member" || !permitted) {
    log.warn("Denied workflow builder request", {
      reason: status.kind === "member" ? "missing_permission" : status.kind,
      organizationId,
      userId,
      error: null,
    });
    scheduleLogFlush();
    return { ok: false, response: forbiddenResponse() };
  }

  return {
    ok: true,
    caller: {
      organizationId,
      userId,
      clerkUserId: user.clerkId,
      canManageProjects:
        status.isOwner || status.permissions.has(OrgPermission.ProjectManage),
    },
  };
}
