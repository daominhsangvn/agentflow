import { failure } from "@repo/api/src/types/common";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import {
  type ProjectRunners,
  updateProjectAgentContactsInputSchema,
} from "@repo/api/src/types/project-runners";
import { NextResponse } from "next/server";
import { z } from "zod";
import { projectAgentContactsService } from "@/app/projects/project-agent-contacts-service";
import { projectRunnersService } from "@/app/projects/project-runners-service";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import { resolveProjectId } from "@/lib/identifier-utils";
import {
  errorResponse,
  notFoundResponse,
  parseBody,
  successResponse,
} from "@/lib/route-utils";

const ROUTE = "/projects/[id]/runners/[computeTargetId]/contacts";
const BODY_MAX_BYTES = 16 * 1024;

/**
 * PUT /projects/{id}/runners/{computeTargetId}/contacts
 * Replaces the contacts of one of the project's Agents
 * (`{ contacts: [{ userId } | { email }] }`): who is emailed when its
 * orchestrated case needs a person. Org admins only.
 */
export const PUT = withAnyAuth<
  ProjectRunners,
  "/projects/[id]/runners/[computeTargetId]/contacts"
>(async (auth, request, params) => {
  try {
    const denied = await denyUnlessPermitted(
      auth,
      { method: request.method, route: ROUTE },
      OrgPermission.ProjectManage
    );
    if (denied) {
      return denied;
    }
    const { id, computeTargetId } = await params;
    if (!z.uuid().safeParse(computeTargetId).success) {
      return notFoundResponse("Agent");
    }
    const { organizationId } = auth.user;
    const projectId = await resolveProjectId(id, organizationId);
    if (!projectId) {
      return notFoundResponse("Project");
    }
    const { body, errorResponse: parseError } = await parseBody(
      request,
      updateProjectAgentContactsInputSchema,
      { maxBytes: BODY_MAX_BYTES }
    );
    if (parseError || !body) {
      return parseError;
    }
    const result = await projectAgentContactsService.replace(
      organizationId,
      projectId,
      computeTargetId,
      body
    );
    if (!result.ok) {
      return NextResponse.json(failure(result.error.message), {
        status: result.error.status,
      });
    }
    const runners = await projectRunnersService.get(organizationId, projectId);
    return runners ? successResponse(runners) : notFoundResponse("Project");
  } catch (error) {
    return errorResponse("Failed to save the Agent's contacts", error);
  }
});
