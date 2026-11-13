import { z } from "zod";

/** Built-in organization roles. Their meaning is fixed and they cannot be edited. */
export const BuiltInOrgRole = {
  Owner: "owner",
  Admin: "admin",
  Member: "member",
} as const;
export type BuiltInOrgRole =
  (typeof BuiltInOrgRole)[keyof typeof BuiltInOrgRole];

/** Permissions an owner can grant to a custom role. */
export const OrgPermission = {
  OrganizationUpdate: "organization:update",
  InvitationCreate: "invitation:create",
  InvitationCancel: "invitation:cancel",
  MemberUpdate: "member:update",
  MemberDelete: "member:delete",
  IntegrationManage: "integration:manage",
  ProjectManage: "project:manage",
  WorkflowManage: "workflow:manage",
  WorkflowRunOperate: "workflowRun:operate",
  OrchestratorOperate: "orchestrator:operate",
  CatalogManage: "catalog:manage",
  CustomFieldManage: "customField:manage",
  ComputeTargetManage: "computeTarget:manage",
  UsageReadAll: "usage:readAll",
  OrgApiKeyManage: "apiKey:manageOrg",
} as const;
export type OrgPermission = (typeof OrgPermission)[keyof typeof OrgPermission];

export const OrgPermissionGroup = {
  Organization: "organization",
  Members: "members",
  Integrations: "integrations",
  Projects: "projects",
  Workflows: "workflows",
  Orchestrator: "orchestrator",
  Catalog: "catalog",
  Settings: "settings",
} as const;
export type OrgPermissionGroup =
  (typeof OrgPermissionGroup)[keyof typeof OrgPermissionGroup];

export type OrgPermissionCatalogueEntry = {
  permission: OrgPermission;
  group: OrgPermissionGroup;
  label: string;
  description: string;
};

export const ORG_PERMISSION_CATALOGUE: readonly OrgPermissionCatalogueEntry[] =
  [
    {
      permission: OrgPermission.OrganizationUpdate,
      group: OrgPermissionGroup.Organization,
      label: "Update organization",
      description:
        "Change the organization name and slug, transcript search, compute mode and frustration setting.",
    },
    {
      permission: OrgPermission.InvitationCreate,
      group: OrgPermissionGroup.Members,
      label: "Invite members",
      description: "Send invitations to join the organization.",
    },
    {
      permission: OrgPermission.InvitationCancel,
      group: OrgPermissionGroup.Members,
      label: "Cancel invitations",
      description: "Revoke pending invitations.",
    },
    {
      permission: OrgPermission.MemberUpdate,
      group: OrgPermissionGroup.Members,
      label: "Change member roles",
      description: "Change the role of a member. Never to or from owner.",
    },
    {
      permission: OrgPermission.MemberDelete,
      group: OrgPermissionGroup.Members,
      label: "Remove members",
      description: "Remove members from the organization.",
    },
    {
      permission: OrgPermission.IntegrationManage,
      group: OrgPermissionGroup.Integrations,
      label: "Manage integrations",
      description:
        "Create, edit and delete integration connections and see their full configuration.",
    },
    {
      permission: OrgPermission.ProjectManage,
      group: OrgPermissionGroup.Projects,
      label: "Manage projects",
      description:
        "Manage project repositories, connections, process, runners and agent instructions.",
    },
    {
      permission: OrgPermission.WorkflowManage,
      group: OrgPermissionGroup.Workflows,
      label: "Manage workflows",
      description: "Create, edit and delete workflows and workflow events.",
    },
    {
      permission: OrgPermission.WorkflowRunOperate,
      group: OrgPermissionGroup.Workflows,
      label: "Operate workflow runs",
      description:
        "Start runs manually, approve, review, retry, cancel and decide tool calls.",
    },
    {
      permission: OrgPermission.OrchestratorOperate,
      group: OrgPermissionGroup.Orchestrator,
      label: "Operate the orchestrator",
      description: "Update and delete cases, make decisions and cancel turns.",
    },
    {
      permission: OrgPermission.CatalogManage,
      group: OrgPermissionGroup.Catalog,
      label: "Manage the catalog",
      description:
        "Manage catalog entries and imports, agent-component promotion and compliance, and distributions.",
    },
    {
      permission: OrgPermission.CustomFieldManage,
      group: OrgPermissionGroup.Settings,
      label: "Manage custom fields",
      description: "Create, edit and delete custom fields.",
    },
    {
      permission: OrgPermission.ComputeTargetManage,
      group: OrgPermissionGroup.Settings,
      label: "Manage compute targets",
      description: "Refresh runner capabilities.",
    },
    {
      permission: OrgPermission.UsageReadAll,
      group: OrgPermissionGroup.Settings,
      label: "Read all usage",
      description: "See organization-wide loop usage and runtime details.",
    },
    {
      permission: OrgPermission.OrgApiKeyManage,
      group: OrgPermissionGroup.Settings,
      label: "Manage organization API keys",
      description: "Create organization API keys and list or revoke any key.",
    },
  ];

/** UI copy for what only an owner can do. These are never grantable. */
export const OWNER_ONLY_CAPABILITIES: readonly string[] = [
  "Delete or disable the organization",
  "Create, edit and delete roles",
  "Assign or remove the owner role",
];

export const ADMIN_DEFAULT_PERMISSIONS: readonly OrgPermission[] =
  Object.values(OrgPermission);

export const MEMBER_DEFAULT_PERMISSIONS: readonly OrgPermission[] = [];

const builtInOrgRoleSet = new Set<string>(Object.values(BuiltInOrgRole));
const orgPermissionSet = new Set<string>(Object.values(OrgPermission));

export function isBuiltInOrgRole(name: string): boolean {
  return builtInOrgRoleSet.has(name);
}

export function parseOrgPermission(value: string): OrgPermission | null {
  return orgPermissionSet.has(value) ? (value as OrgPermission) : null;
}

/** `["member:update"]` becomes `{ member: ["update"] }`. */
export function toPermissionStatements(
  perms: readonly OrgPermission[]
): Record<string, string[]> {
  const statements: Record<string, string[]> = {};
  for (const permission of perms) {
    const [resource, action] = permission.split(":");
    if (!(resource && action)) {
      continue;
    }
    const actions = statements[resource] ?? [];
    if (!actions.includes(action)) {
      actions.push(action);
    }
    statements[resource] = actions;
  }
  return statements;
}

/** Inverse of `toPermissionStatements`; unknown resource/action pairs are ignored. */
export function fromPermissionStatements(
  record: Record<string, string[]>
): OrgPermission[] {
  const result: OrgPermission[] = [];
  for (const [resource, actions] of Object.entries(record)) {
    for (const action of actions) {
      const permission = parseOrgPermission(`${resource}:${action}`);
      if (permission && !result.includes(permission)) {
        result.push(permission);
      }
    }
  }
  return result;
}

export const customOrgRoleNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/)
  .refine((name) => !isBuiltInOrgRole(name), {
    message: "Role name is reserved",
  });

export const BUILT_IN_ROLE_PERMISSIONS: Record<
  BuiltInOrgRole,
  readonly OrgPermission[]
> = {
  [BuiltInOrgRole.Owner]: Object.values(OrgPermission),
  [BuiltInOrgRole.Admin]: ADMIN_DEFAULT_PERMISSIONS,
  [BuiltInOrgRole.Member]: MEMBER_DEFAULT_PERMISSIONS,
};

/** Splits Better Auth's comma-joined role string into trimmed, non-empty names. */
export function splitOrgRoleNames(authRole: string): string[] {
  return authRole
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** True only when every `resource:action` pair is in the grantable catalogue. */
export function isGrantableStatementMap(
  record: Record<string, readonly string[]>
): boolean {
  return Object.entries(record).every(([resource, actions]) =>
    actions.every((action) => parseOrgPermission(`${resource}:${action}`))
  );
}

/**
 * Whether a caller may give a role to someone. Only an owner assigns owner;
 * anyone else may assign a role whose permissions they all hold themselves.
 */
export function canAssignOrgRole(input: {
  callerIsOwner: boolean;
  callerPermissions: ReadonlySet<OrgPermission>;
  targetRoleNames: readonly string[];
  targetPermissions: readonly OrgPermission[];
}): boolean {
  if (input.targetRoleNames.includes(BuiltInOrgRole.Owner)) {
    return input.callerIsOwner;
  }
  if (input.callerIsOwner) {
    return true;
  }
  return input.targetPermissions.every((p) => input.callerPermissions.has(p));
}
