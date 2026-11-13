import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_PERMISSIONS,
  BUILT_IN_ROLE_PERMISSIONS,
  BuiltInOrgRole,
  canAssignOrgRole,
  customOrgRoleNameSchema,
  fromPermissionStatements,
  isBuiltInOrgRole,
  isGrantableStatementMap,
  MEMBER_DEFAULT_PERMISSIONS,
  ORG_PERMISSION_CATALOGUE,
  OrgPermission,
  parseOrgPermission,
  splitOrgRoleNames,
  toPermissionStatements,
} from "./org-permissions";

describe("permission statements", () => {
  it("round-trips every permission", () => {
    const all = Object.values(OrgPermission);
    const back = fromPermissionStatements(toPermissionStatements(all));
    expect([...back].sort()).toEqual([...all].sort());
  });

  it("drops unknown pairs", () => {
    expect(
      fromPermissionStatements({
        member: ["update", "explode"],
        nothing: ["read"],
      })
    ).toEqual([OrgPermission.MemberUpdate]);
  });
});

describe("customOrgRoleNameSchema", () => {
  it("rejects built-in, uppercase and too short names", () => {
    expect(
      customOrgRoleNameSchema.safeParse(BuiltInOrgRole.Owner).success
    ).toBe(false);
    expect(customOrgRoleNameSchema.safeParse("Admin").success).toBe(false);
    expect(customOrgRoleNameSchema.safeParse("a").success).toBe(false);
  });

  it("accepts a valid name", () => {
    expect(customOrgRoleNameSchema.safeParse("release-manager").success).toBe(
      true
    );
  });
});

describe("helpers", () => {
  it("detects built-in roles", () => {
    expect(isBuiltInOrgRole("admin")).toBe(true);
    expect(isBuiltInOrgRole("release-manager")).toBe(false);
  });

  it("parses permissions", () => {
    expect(parseOrgPermission("member:update")).toBe(
      OrgPermission.MemberUpdate
    );
    expect(parseOrgPermission("nope")).toBeNull();
  });

  it("covers every permission exactly once in the catalogue", () => {
    const listed = ORG_PERMISSION_CATALOGUE.map((entry) => entry.permission);
    expect([...listed].sort()).toEqual(Object.values(OrgPermission).sort());
  });

  it("sets role defaults", () => {
    expect(ADMIN_DEFAULT_PERMISSIONS).toHaveLength(
      Object.values(OrgPermission).length
    );
    expect(MEMBER_DEFAULT_PERMISSIONS).toEqual([]);
  });
});

describe("role assignment helpers", () => {
  it("splits role names", () => {
    expect(splitOrgRoleNames("admin, x,")).toEqual(["admin", "x"]);
  });

  it("owner role covers every permission", () => {
    expect([...BUILT_IN_ROLE_PERMISSIONS[BuiltInOrgRole.Owner]].sort()).toEqual(
      Object.values(OrgPermission).sort()
    );
    expect(BUILT_IN_ROLE_PERMISSIONS[BuiltInOrgRole.Member]).toEqual([]);
  });

  it("checks grantable statement maps", () => {
    expect(isGrantableStatementMap({})).toBe(true);
    expect(
      isGrantableStatementMap(
        toPermissionStatements(Object.values(OrgPermission))
      )
    ).toBe(true);
    expect(isGrantableStatementMap({ organization: ["delete"] })).toBe(false);
    expect(isGrantableStatementMap({ ac: ["read"] })).toBe(false);
    expect(isGrantableStatementMap({ team: ["create"] })).toBe(false);
    expect(isGrantableStatementMap({ member: ["create"] })).toBe(false);
  });

  const helper = [OrgPermission.MemberUpdate, OrgPermission.InvitationCreate];
  const base = {
    callerIsOwner: false,
    callerPermissions: new Set(helper),
  };

  it("lets an owner assign any role", () => {
    const owner = { ...base, callerIsOwner: true };
    expect(
      canAssignOrgRole({
        ...owner,
        targetRoleNames: [BuiltInOrgRole.Owner],
        targetPermissions: Object.values(OrgPermission),
      })
    ).toBe(true);
    expect(
      canAssignOrgRole({
        ...owner,
        targetRoleNames: [BuiltInOrgRole.Admin],
        targetPermissions: ADMIN_DEFAULT_PERMISSIONS,
      })
    ).toBe(true);
  });

  it("never lets a non-owner assign owner", () => {
    expect(
      canAssignOrgRole({
        ...base,
        callerPermissions: new Set(Object.values(OrgPermission)),
        targetRoleNames: [BuiltInOrgRole.Owner],
        targetPermissions: Object.values(OrgPermission),
      })
    ).toBe(false);
  });

  it("limits a custom caller to roles within its own permissions", () => {
    expect(
      canAssignOrgRole({
        ...base,
        targetRoleNames: [BuiltInOrgRole.Admin],
        targetPermissions: ADMIN_DEFAULT_PERMISSIONS,
      })
    ).toBe(false);
    expect(
      canAssignOrgRole({
        ...base,
        targetRoleNames: [BuiltInOrgRole.Member],
        targetPermissions: [],
      })
    ).toBe(true);
    expect(
      canAssignOrgRole({
        ...base,
        targetRoleNames: ["helper"],
        targetPermissions: helper,
      })
    ).toBe(true);
  });

  it("lets an admin-permission caller assign admin", () => {
    expect(
      canAssignOrgRole({
        ...base,
        callerPermissions: new Set(ADMIN_DEFAULT_PERMISSIONS),
        targetRoleNames: [BuiltInOrgRole.Admin],
        targetPermissions: ADMIN_DEFAULT_PERMISSIONS,
      })
    ).toBe(true);
  });
});
