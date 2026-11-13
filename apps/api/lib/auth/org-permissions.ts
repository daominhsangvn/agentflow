import {
  BuiltInOrgRole,
  type OrgPermission,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import type { RoleReader } from "./role-assignment";
import { resolveRolePermissions } from "./role-permissions";

export type OrgPermissionStatus =
  | { kind: "member"; isOwner: boolean; permissions: Set<OrgPermission> }
  | { kind: "not_member" }
  | { kind: "provider_error" };

/**
 * Permissions of a member from the role(s) Better Auth stores (bare names,
 * possibly comma-joined). Custom roles are read from `auth_organization_roles`.
 */
export function resolveMemberPermissions(
  authRole: string,
  organizationId: string
): Promise<OrgPermission[]> {
  return resolveRolePermissions(authRole, (names) =>
    loadCustomRolePermissionJson(organizationId, names)
  );
}

/** Prisma-backed `RoleReader` for API routes (Better Auth hooks use the adapter). */
export const prismaRoleReader: RoleReader = {
  findMemberRole: (organizationId, userId) =>
    withDb((db) =>
      db.authMember.findFirst({
        where: { organizationId, userId },
        select: { id: true, role: true },
      })
    ),
  findMember: (memberId) =>
    withDb((db) =>
      db.authMember.findUnique({
        where: { id: memberId },
        select: { id: true, userId: true, organizationId: true, role: true },
      })
    ),
  loadCustomRolePermissionJson,
};

export async function getOrgPermissionStatus(
  clerkOrgId: string,
  clerkUserId: string
): Promise<OrgPermissionStatus> {
  try {
    const member = await withDb((db) =>
      db.authMember.findFirst({
        where: { organizationId: clerkOrgId, userId: clerkUserId },
        select: { role: true },
      })
    );
    if (!member) {
      return { kind: "not_member" };
    }
    const permissions = await resolveMemberPermissions(member.role, clerkOrgId);
    const isOwner = splitOrgRoleNames(member.role).includes(
      BuiltInOrgRole.Owner
    );
    return { kind: "member", isOwner, permissions: new Set(permissions) };
  } catch (error) {
    log.error("Failed to resolve organization permissions", {
      clerkOrgId,
      clerkUserId,
      error,
    });
    return { kind: "provider_error" };
  }
}

export async function hasOrgPermission(
  clerkOrgId: string,
  clerkUserId: string,
  permission: OrgPermission
): Promise<boolean> {
  const status = await getOrgPermissionStatus(clerkOrgId, clerkUserId);
  if (status.kind !== "member") {
    return false;
  }
  return status.isOwner || status.permissions.has(permission);
}

export async function isOrgOwner(
  clerkOrgId: string,
  clerkUserId: string
): Promise<boolean> {
  const status = await getOrgPermissionStatus(clerkOrgId, clerkUserId);
  return status.kind === "member" && status.isOwner;
}

async function loadCustomRolePermissionJson(
  organizationId: string,
  names: string[]
): Promise<string[]> {
  const rows = await withDb((db) =>
    db.authOrganizationRole.findMany({
      where: { organizationId, role: { in: names } },
      select: { permission: true },
    })
  );
  return rows.map((row) => row.permission);
}
