import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { describe, expect, it } from "vitest";

import { ac, orgRoles } from "@/lib/auth/access-control";

const GRANTABLE = Object.values(OrgPermission).map(
  (p) => p.split(":") as [string, string]
);

function can(role: keyof typeof orgRoles, resource: string, action: string) {
  return orgRoles[role].authorize({ [resource]: [action] } as never).success;
}

describe("orgRoles", () => {
  it("lets the owner do everything including ac and organization delete", () => {
    expect(can("owner", "ac", "create")).toBe(true);
    expect(can("owner", "organization", "delete")).toBe(true);
    for (const [resource, action] of GRANTABLE) {
      expect(can("owner", resource, action)).toBe(true);
    }
  });

  it("gives the admin every grantable permission but not owner-only ones", () => {
    for (const [resource, action] of GRANTABLE) {
      expect(can("admin", resource, action)).toBe(true);
    }
    expect(can("admin", "ac", "read")).toBe(true);
    expect(can("admin", "ac", "create")).toBe(false);
    expect(can("admin", "ac", "update")).toBe(false);
    expect(can("admin", "ac", "delete")).toBe(false);
    expect(can("admin", "organization", "delete")).toBe(false);
  });

  it("lets only the owner create, update and delete roles", () => {
    for (const action of ["create", "update", "delete"]) {
      expect(can("owner", "ac", action)).toBe(true);
      expect(can("admin", "ac", action)).toBe(false);
      expect(can("member", "ac", action)).toBe(false);
    }
  });

  it("offers custom roles only the catalogue resources", () => {
    const resources = new Set(GRANTABLE.map(([resource]) => resource));
    expect(new Set(Object.keys(ac.statements))).toEqual(resources);
    expect(Object.keys(ac.statements)).not.toContain("ac");
    expect(Object.keys(ac.statements)).not.toContain("team");
    expect(ac.statements.organization).toEqual(["update"]);
  });

  it("gives the member only ac:read among the AgentFlow statements", () => {
    expect(can("member", "ac", "read")).toBe(true);
    for (const [resource, action] of GRANTABLE) {
      expect(can("member", resource, action)).toBe(false);
    }
  });
});
