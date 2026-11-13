import {
  ADMIN_DEFAULT_PERMISSIONS,
  OrgPermission,
  toPermissionStatements,
} from "@repo/api/src/types/org-permissions";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Better Auth organization access control. Built-in roles are built from the
 * Better Auth defaults plus the AgentFlow permission catalogue
 * (`resource:action`); custom roles may name only the catalogue (A27).
 * `ac:*` (role create/update/delete) and `organization:delete` stay
 * owner-only.
 */

type StatementMap = Record<string, string[]>;

const AGENTFLOW_STATEMENTS = toPermissionStatements(
  Object.values(OrgPermission)
);

const ALL_STATEMENTS = mergeStatements(
  cloneStatements(defaultStatements),
  AGENTFLOW_STATEMENTS
);

// Built-in roles are built from the full statement set (owner holds ac:*).
const builtInAc = createAccessControl(ALL_STATEMENTS);

/**
 * The `ac` instance handed to the organization plugin, so the statements a
 * custom role may name: the catalogue only. No `ac`, `team`, `member:create`,
 * `organization:delete` or the default `invitation:*` statements (A27).
 * Better Auth builds custom roles with `ac.newRole(...)` without validating
 * actions, so `auth-endpoint-guards.ts` also checks each pair on create/update.
 */
export const ac = createAccessControl(AGENTFLOW_STATEMENTS);

const adminStatements = mergeStatements(
  withoutResource(
    withoutAction(
      cloneStatements(adminAc.statements),
      "organization",
      "delete"
    ),
    "ac"
  ),
  toPermissionStatements(ADMIN_DEFAULT_PERMISSIONS)
);

export const orgRoles = {
  owner: builtInAc.newRole(
    mergeStatements(
      cloneStatements(ownerAc.statements),
      AGENTFLOW_STATEMENTS
    ) as never
  ),
  admin: builtInAc.newRole(
    mergeStatements(adminStatements, { ac: ["read"] }) as never
  ),
  member: builtInAc.newRole(
    mergeStatements(cloneStatements(memberAc.statements), {
      ac: ["read"],
    }) as never
  ),
};

function cloneStatements(
  source: Record<string, readonly string[]>
): StatementMap {
  const result: StatementMap = {};
  for (const [resource, actions] of Object.entries(source)) {
    result[resource] = [...actions];
  }
  return result;
}

function mergeStatements(
  base: StatementMap,
  extra: StatementMap
): StatementMap {
  const result = cloneStatements(base);
  for (const [resource, actions] of Object.entries(extra)) {
    const merged = new Set(result[resource] ?? []);
    for (const action of actions) {
      merged.add(action);
    }
    result[resource] = [...merged];
  }
  return result;
}

function withoutAction(
  source: StatementMap,
  resource: string,
  action: string
): StatementMap {
  return {
    ...source,
    [resource]: (source[resource] ?? []).filter((item) => item !== action),
  };
}

function withoutResource(source: StatementMap, resource: string): StatementMap {
  const { [resource]: _removed, ...rest } = source;
  return rest;
}
