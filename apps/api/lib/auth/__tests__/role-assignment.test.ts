import { describe, expect, it } from "vitest";

import {
  checkRoleAssignment,
  RoleAssignmentDenial,
  type RoleReader,
} from "@/lib/auth/role-assignment";

const ORG = "org-1";

type Member = {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
};

function reader(members: Member[], roles: Record<string, string>): RoleReader {
  return {
    findMemberRole: (organizationId, userId) =>
      Promise.resolve(
        members.find(
          (m) => m.organizationId === organizationId && m.userId === userId
        ) ?? null
      ),
    findMember: (memberId) =>
      Promise.resolve(members.find((m) => m.id === memberId) ?? null),
    loadCustomRolePermissionJson: (_org, names) =>
      Promise.resolve(names.flatMap((n) => (roles[n] ? [roles[n]] : []))),
  };
}

const members: Member[] = [
  { id: "m-owner", userId: "owner", organizationId: ORG, role: "owner" },
  { id: "m-admin", userId: "admin", organizationId: ORG, role: "admin" },
  { id: "m-helper", userId: "helper", organizationId: ORG, role: "helper" },
  { id: "m-plain", userId: "plain", organizationId: ORG, role: "member" },
];
const roles = {
  helper: JSON.stringify({ member: ["update"] }),
  subset: JSON.stringify({ member: ["update"] }),
  empty: JSON.stringify({}),
};
const r = reader(members, roles);

function check(callerUserId: string, targetRole: string, memberId?: string) {
  return checkRoleAssignment(r, {
    organizationId: ORG,
    callerUserId,
    targetRole,
    memberId,
  });
}

describe("checkRoleAssignment", () => {
  it("lets an owner assign admin and owner", async () => {
    expect(await check("owner", "admin")).toBeNull();
    expect(await check("owner", "owner")).toBeNull();
  });

  it("refuses a custom caller a role above its permissions", async () => {
    expect(await check("helper", "admin")).toBe(
      RoleAssignmentDenial.RoleExceedsCaller
    );
  });

  it("allows member and an equal or subset custom role", async () => {
    expect(await check("helper", "member")).toBeNull();
    expect(await check("helper", "subset")).toBeNull();
    expect(await check("helper", "helper")).toBeNull();
  });

  it("refuses demoting someone who outranks the caller", async () => {
    expect(await check("helper", "member", "m-admin")).toBe(
      RoleAssignmentDenial.MemberOutranksCaller
    );
  });

  it("refuses changing your own role, owners included", async () => {
    expect(await check("helper", "member", "m-helper")).toBe(
      RoleAssignmentDenial.OwnRole
    );
    expect(await check("owner", "admin", "m-owner")).toBe(
      RoleAssignmentDenial.OwnRole
    );
  });

  it("refuses a non-member", async () => {
    expect(await check("stranger", "member")).toBe(
      RoleAssignmentDenial.NotMember
    );
  });

  it("refuses a non-owner touching an owner", async () => {
    expect(await check("admin", "member", "m-owner")).toBe(
      RoleAssignmentDenial.OwnerOnly
    );
    expect(await check("admin", "owner")).toBe(RoleAssignmentDenial.OwnerOnly);
  });

  it("skips a member that is missing or in another org", async () => {
    expect(await check("admin", "member", "missing")).toBeNull();
  });
});
