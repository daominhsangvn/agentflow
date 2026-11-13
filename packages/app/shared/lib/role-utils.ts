import {
  BuiltInOrgRole,
  type OrgPermission,
} from "@repo/api/src/types/org-permissions";

/**
 * Client-side permission utilities.
 *
 * The membership comes from the session claims (`org_permissions`), which is
 * a UI hint only: the API re-checks every permission.
 */

const OWNER_ROLE = `org:${BuiltInOrgRole.Owner}`;

export type PermissionMembership = {
  role?: string;
  permissions?: readonly string[];
};

/**
 * Whether the membership holds a permission. The owner holds every
 * permission implicitly.
 */
export function hasOrgPermission(
  membership: PermissionMembership | null | undefined,
  permission: OrgPermission
): boolean {
  if (!membership) {
    return false;
  }
  if (membership.role === OWNER_ROLE) {
    return true;
  }
  return membership.permissions?.includes(permission) ?? false;
}
