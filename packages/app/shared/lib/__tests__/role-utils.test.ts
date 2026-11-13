import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { describe, expect, it } from "vitest";
import { hasOrgPermission } from "../role-utils";

describe("hasOrgPermission", () => {
  it("treats the owner as holding every permission", () => {
    expect(
      hasOrgPermission({ role: "org:owner" }, OrgPermission.CatalogManage)
    ).toBe(true);
  });

  it("grants only the listed permissions to other roles", () => {
    const membership = {
      role: "org:qa",
      permissions: [OrgPermission.CatalogManage],
    };
    expect(hasOrgPermission(membership, OrgPermission.CatalogManage)).toBe(
      true
    );
    expect(hasOrgPermission(membership, OrgPermission.ProjectManage)).toBe(
      false
    );
  });

  it("denies a missing membership or missing permissions", () => {
    expect(hasOrgPermission(undefined, OrgPermission.CatalogManage)).toBe(
      false
    );
    expect(hasOrgPermission(null, OrgPermission.CatalogManage)).toBe(false);
    expect(
      hasOrgPermission({ role: "org:member" }, OrgPermission.CatalogManage)
    ).toBe(false);
  });
});
