import {
  ADMIN_DEFAULT_PERMISSIONS,
  OrgPermission,
} from "@repo/api/src/types/org-permissions";
import { describe, expect, it } from "vitest";
import {
  canEditMemberRole,
  roleOptions,
} from "../components/organization-profile";

const customRoles = [
  { id: "1", role: "reviewer", permissions: [OrgPermission.MemberUpdate] },
  { id: "2", role: "billing", permissions: [OrgPermission.OrganizationUpdate] },
];
const memberUpdateOnly = new Set([OrgPermission.MemberUpdate]);
const adminPermissions = new Set(ADMIN_DEFAULT_PERMISSIONS);

describe("roleOptions", () => {
  it("offers everything to the owner", () => {
    expect(
      roleOptions({
        callerIsOwner: true,
        callerPermissions: new Set(),
        customRoles,
      })
    ).toEqual(["owner", "admin", "member", "reviewer", "billing"]);
  });

  it("offers a member:update caller member and subset custom roles only", () => {
    expect(
      roleOptions({
        callerIsOwner: false,
        callerPermissions: memberUpdateOnly,
        customRoles,
      })
    ).toEqual(["member", "reviewer"]);
  });

  it("offers an admin caller admin, member and custom roles", () => {
    const options = roleOptions({
      callerIsOwner: false,
      callerPermissions: adminPermissions,
      customRoles,
    });
    expect(options).toContain("admin");
    expect(options).toContain("member");
    expect(options).not.toContain("owner");
  });
});

describe("canEditMemberRole", () => {
  const base = { callerPermissions: memberUpdateOnly, customRoles };

  it("is false for self", () => {
    expect(
      canEditMemberRole({
        ...base,
        callerIsOwner: true,
        memberRole: "member",
        isSelf: true,
      })
    ).toBe(false);
  });

  it("is false for a custom caller over an admin", () => {
    expect(
      canEditMemberRole({
        ...base,
        callerIsOwner: false,
        memberRole: "admin",
        isSelf: false,
      })
    ).toBe(false);
  });

  it("is true for a custom caller over a member", () => {
    expect(
      canEditMemberRole({
        ...base,
        callerIsOwner: false,
        memberRole: "member",
        isSelf: false,
      })
    ).toBe(true);
  });

  it("is false for an unknown custom role", () => {
    expect(
      canEditMemberRole({
        ...base,
        callerIsOwner: false,
        memberRole: "ghost",
        isSelf: false,
      })
    ).toBe(false);
  });

  it("is true for the owner over anyone else", () => {
    expect(
      canEditMemberRole({
        ...base,
        callerIsOwner: true,
        memberRole: "admin",
        isSelf: false,
      })
    ).toBe(true);
  });
});
