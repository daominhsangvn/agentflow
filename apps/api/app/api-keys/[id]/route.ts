import { AuditAction, AuditObjectType } from "@repo/api/src/types/audit";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import {
  dispatchAuditEvent,
  userAuditActor,
} from "@/app/audit/audit-emit-service";
import { hasOrgPermission } from "@/lib/auth/org-permissions";
import { withAuth } from "@/lib/auth/with-auth";
import {
  deleteResponse,
  errorResponse,
  notFoundResponse,
} from "@/lib/route-utils";
import { apiKeysService } from "../service";

export const DELETE = withAuth<{ deleted: true }, "/api-keys/[id]">(
  async ({ user, clerkOrgId, clerkUserId }, _, params) => {
    try {
      const canManageAll = await hasOrgPermission(
        clerkOrgId,
        clerkUserId,
        OrgPermission.OrgApiKeyManage
      );
      const { id } = await params;
      const revoked = await apiKeysService.revoke(
        id,
        user.organizationId,
        user.id,
        canManageAll
      );

      if (!revoked) {
        return notFoundResponse("API key");
      }

      // Record the key revocation on the tamper-evident audit ledger (FEA-3862).
      // Non-blocking/best-effort; only the key id is recorded, no secret.
      dispatchAuditEvent({
        organizationId: user.organizationId,
        actor: userAuditActor(user.id),
        action: AuditAction.ApiKeyRevoked,
        objectType: AuditObjectType.ApiKey,
        objectId: id,
      });

      return deleteResponse();
    } catch (error) {
      return errorResponse("Failed to revoke API key", error);
    }
  }
);
