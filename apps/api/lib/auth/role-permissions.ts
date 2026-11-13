import {
  BUILT_IN_ROLE_PERMISSIONS,
  type BuiltInOrgRole,
  fromPermissionStatements,
  isBuiltInOrgRole,
  type OrgPermission,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
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
  } catch {
    return [];
  }
  const parsed = permissionRecordSchema.safeParse(json);
  return parsed.success ? fromPermissionStatements(parsed.data) : [];
}

function addAll(target: Set<OrgPermission>, items: readonly OrgPermission[]) {
  for (const item of items) {
    target.add(item);
  }
}
