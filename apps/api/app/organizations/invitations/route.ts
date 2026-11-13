import {
  type InviteMembersResponse,
  OrgInviteRole,
} from "@repo/api/src/types/onboarding";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { toAuthRole } from "@/lib/auth/identity-service";
import { hasOrgPermission, prismaRoleReader } from "@/lib/auth/org-permissions";
import { checkRoleAssignment } from "@/lib/auth/role-assignment";
import { withAnyAuth } from "@/lib/auth/with-any-auth";
import {
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
  parseBody,
  successResponse,
} from "@/lib/route-utils";
import { organizationsService } from "../service";
import { inviteMembersValidator } from "../validators";
import { invitationsService } from "./service";

/**
 * POST /organizations/invitations
 *
 * "Invite your team" (PRD-532 §5.4). Creates Better Auth organization
 * invitations for the caller's own organization; the invitee joins the
 * caller's org by accepting the emailed link.
 *
 * Org-scoping: the target org is derived from the authenticated caller's
 * session (`user.organizationId`), never from the request body. The caller
 * needs `InvitationCreate` and may only invite with a role whose permissions
 * they hold themselves (A26).
 */
export const POST = withAnyAuth<
  InviteMembersResponse,
  "/organizations/invitations"
>(async ({ user }, request) => {
  try {
    const { body, errorResponse: parseError } = await parseBody(
      request,
      inviteMembersValidator
    );
    if (parseError || !body) {
      return parseError;
    }

    // Resolve the caller's org to its Clerk id — the invitation is always
    // scoped to the caller's own organization.
    const organization = await organizationsService.findById(
      user.organizationId
    );
    if (!organization) {
      return notFoundResponse("Organization");
    }

    // Only org admins/owners may invite. Authorization is checked against
    // Clerk's membership role for the caller in this specific org.
    const callerIsAdmin = await hasOrgPermission(
      organization.clerkId,
      user.clerkId,
      OrgPermission.InvitationCreate
    );
    if (!callerIsAdmin) {
      return forbiddenResponse();
    }

    const denial = await checkRoleAssignment(prismaRoleReader, {
      organizationId: organization.clerkId,
      callerUserId: user.clerkId,
      targetRole: toAuthRole(body.role ?? OrgInviteRole.Member),
    });
    if (denial) {
      return forbiddenResponse();
    }

    const response = await invitationsService.inviteMembers({
      clerkOrgId: organization.clerkId,
      inviterClerkUserId: user.clerkId,
      emailAddresses: body.emailAddresses,
      role: body.role,
    });

    return successResponse(response);
  } catch (error) {
    return errorResponse("Failed to send invitations", error);
  }
});
