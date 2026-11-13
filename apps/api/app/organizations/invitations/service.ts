import {
  type InviteMemberResult,
  type InviteMembersResponse,
  OrgInviteRole,
} from "@repo/api/src/types/onboarding";
import { log } from "@repo/observability/log";
import {
  DuplicateInvitationError,
  identityService,
} from "@/lib/auth/identity-service";

export const invitationsService = {
  /**
   * Create an organization invitation for each email. Invitations are made
   * per-email and aggregated per-email outcomes — one bad address does not abort the rest.
   * De-duplication is handled upstream by the Zod validator.
   */
  async inviteMembers(params: {
    clerkOrgId: string;
    inviterClerkUserId: string;
    emailAddresses: string[];
    role?: OrgInviteRole;
  }): Promise<InviteMembersResponse> {
    const role = params.role ?? OrgInviteRole.Member;
    const results: InviteMemberResult[] = [];

    for (const email of params.emailAddresses) {
      try {
        const invitation = await identityService.createOrganizationInvitation({
          organizationId: params.clerkOrgId,
          emailAddress: email,
          role,
          inviterUserId: params.inviterClerkUserId,
        });
        results.push({
          email,
          invitationId: invitation.id,
          status: "invited",
        });
      } catch (error) {
        if (error instanceof DuplicateInvitationError) {
          results.push({
            email,
            status: "already_member",
            reason: error.message,
          });
          continue;
        }
        log.error("Failed to create organization invitation", {
          clerkOrgId: params.clerkOrgId,
          email,
          error,
        });
        results.push({
          email,
          status: "failed",
          reason: "Failed to send invitation",
        });
      }
    }

    const invited = results.filter((r) => r.status === "invited").length;
    return { invited, results };
  },
};
