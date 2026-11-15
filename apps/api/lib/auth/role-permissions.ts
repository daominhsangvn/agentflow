import {
  BUILT_IN_ROLE_PERMISSIONS,
  type BuiltInOrgRole,
  fromPermissionStatements,
  isBuiltInOrgRole,
  type OrgPermission,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
import { log } from "@repo/observability/log";
import { z } from "zod";

/**
 * Pure role to permission resolution, shared by the Prisma-backed request
 * path (`org-permissions.ts`) and the Better Auth hooks, which read through
 * the Better Auth adapter instead. No database import here.
 */

const permissionRecordSchema = z.record(z.string(), z.array(z.string()));

/**
 * Permissions of a member from the role(s) Better Auth stores (bare names,
 * possibly comma-joined). `loadCustomRolePermissionJson` returns the stored
 * permission JSON of the given custom role names.
 */
export async function resolveRolePermissions(
  authRole: string,
  loadCustomRolePermissionJson: (names: string[]) => Promise<string[]>
): Promise<OrgPermission[]> {
  const result = new Set<OrgPermission>();
  const customRoles: string[] = [];
  for (const role of splitOrgRoleNames(authRole)) {
    if (isBuiltInOrgRole(role)) {
      addAll(result, BUILT_IN_ROLE_PERMISSIONS[role as BuiltInOrgRole]);
    } else {
      customRoles.push(role);
    }
  }
  if (customRoles.length > 0) {
    for (const raw of await loadCustomRolePermissionJson(customRoles)) {
      addAll(result, parseStoredPermissions(raw));
    }
  }
  return [...result];
}

export function parseStoredPermissions(raw: string): OrgPermission[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    log.warn("auth.custom_role_permissions_invalid", {
      reason: "permission_json_unparseable",
      error,
    });
    return [];
  }
  const parsed = permissionRecordSchema.safeParse(json);
  if (!parsed.success) {
    log.warn("auth.custom_role_permissions_invalid", {
      reason: "permission_json_shape_invalid",
    });
    return [];
  }
  return fromPermissionStatements(parsed.data);
}

function addAll(target: Set<OrgPermission>, items: readonly OrgPermission[]) {
  for (const item of items) {
    target.add(item);
  }
}
