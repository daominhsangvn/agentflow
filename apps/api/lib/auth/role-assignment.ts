import {
  BuiltInOrgRole,
  canAssignOrgRole,
  type OrgPermission,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
import type { DBAdapter } from "better-auth";
import { resolveRolePermissions } from "./role-permissions";

/**
 * Who may give which role (A26). A caller may invite with, or assign, a role
 * only when every permission of that role is one the caller holds; only an
 * owner assigns owner, and nobody changes their own role. Pure: reads go
 * through a `RoleReader`, so Better Auth hooks and API routes share the rule.
 */

export const RoleAssignmentDenial = {
  NotMember: "not_member",
  OwnerOnly: "owner_only",
  RoleExceedsCaller: "role_exceeds_caller",
  MemberOutranksCaller: "member_outranks_caller",
  OwnRole: "own_role",
} as const;
export type RoleAssignmentDenial =
  (typeof RoleAssignmentDenial)[keyof typeof RoleAssignmentDenial];

export type RoleReader = {
  findMemberRole(
    organizationId: string,
    userId: string
  ): Promise<{ id: string; role: string } | null>;
  findMember(memberId: string): Promise<{
    id: string;
    userId: string;
    organizationId: string;
    role: string;
  } | null>;
  loadCustomRolePermissionJson(
    organizationId: string,
    names: string[]
  ): Promise<string[]>;
};

type Caller = {
  isOwner: boolean;
  permissions: ReadonlySet<OrgPermission>;
};

export async function checkRoleAssignment(
  reader: RoleReader,
  input: {
    organizationId: string;
    callerUserId: string;
    targetRole: string;
    memberId?: string;
  }
): Promise<RoleAssignmentDenial | null> {
  const membership = await reader.findMemberRole(
    input.organizationId,
    input.callerUserId
  );
  if (!membership) {
    return RoleAssignmentDenial.NotMember;
  }
  const load = (names: string[]) =>
    reader.loadCustomRolePermissionJson(input.organizationId, names);
  const caller: Caller = {
    isOwner: splitOrgRoleNames(membership.role).includes(BuiltInOrgRole.Owner),
    permissions: new Set(await resolveRolePermissions(membership.role, load)),
  };

  if (input.memberId) {
    const denial = await checkExistingMember(reader, load, caller, {
      organizationId: input.organizationId,
      callerUserId: input.callerUserId,
      memberId: input.memberId,
    });
    if (denial) {
      return denial;
    }
  }

  const allowed = await canAssign(load, caller, input.targetRole);
  if (allowed) {
    return null;
  }
  return isOwnerRole(input.targetRole)
    ? RoleAssignmentDenial.OwnerOnly
    : RoleAssignmentDenial.RoleExceedsCaller;
}

/**
 * Reads membership and custom roles through Better Auth's adapter, using the
 * logical model names `member` and `organizationRole`.
 */
export function adapterRoleReader(
  adapter: Pick<DBAdapter, "findOne" | "findMany">
): RoleReader {
  return {
    findMemberRole: (organizationId, userId) =>
      adapter.findOne<{ id: string; role: string }>({
        model: "member",
        where: [
          { field: "organizationId", value: organizationId },
          { field: "userId", value: userId },
        ],
      }),
    findMember: (memberId) =>
      adapter.findOne<{
        id: string;
        userId: string;
        organizationId: string;
        role: string;
      }>({
        model: "member",
        where: [{ field: "id", value: memberId }],
      }),
    loadCustomRolePermissionJson: async (organizationId, names) => {
      const rows = await adapter.findMany<{ permission: string }>({
        model: "organizationRole",
        where: [
          { field: "organizationId", value: organizationId },
          { field: "role", value: names, operator: "in" },
        ],
      });
      return rows.map((row) => row.permission);
    },
  };
}

async function checkExistingMember(
  reader: RoleReader,
  load: (names: string[]) => Promise<string[]>,
  caller: Caller,
  input: { organizationId: string; callerUserId: string; memberId: string }
): Promise<RoleAssignmentDenial | null> {
  const member = await reader.findMember(input.memberId);
  if (!member || member.organizationId !== input.organizationId) {
    return null;
  }
  if (member.userId === input.callerUserId) {
    return RoleAssignmentDenial.OwnRole;
  }
  if (caller.isOwner || (await canAssign(load, caller, member.role))) {
    return null;
  }
  return isOwnerRole(member.role)
    ? RoleAssignmentDenial.OwnerOnly
    : RoleAssignmentDenial.MemberOutranksCaller;
}

async function canAssign(
  load: (names: string[]) => Promise<string[]>,
  caller: Caller,
  role: string
): Promise<boolean> {
  return canAssignOrgRole({
    callerIsOwner: caller.isOwner,
    callerPermissions: caller.permissions,
    targetRoleNames: splitOrgRoleNames(role),
    targetPermissions: await resolveRolePermissions(role, load),
  });
}

function isOwnerRole(role: string): boolean {
  return splitOrgRoleNames(role).includes(BuiltInOrgRole.Owner);
}
