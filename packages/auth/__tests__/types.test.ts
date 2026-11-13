import { describe, expect, it } from "vitest";
import {
  authStateFromClaims,
  hasAccess,
  organizationFromClaims,
  userFromClaims,
} from "../types";

const CLAIMS = {
  sub: "user-1",
  email: "ada@example.test",
  name: "Ada Lovelace",
  image: null,
  org_id: "org-1",
  org_slug: "acme",
  org_name: "Acme",
  org_role: "org:owner",
};

describe("claims mapping", () => {
  it("maps claims to the auth state fields the app reads", () => {
    expect(authStateFromClaims(CLAIMS)).toMatchObject({
      isAuthenticated: true,
      userId: "user-1",
      orgId: "org-1",
      orgSlug: "acme",
      orgRole: "org:owner",
    });
    expect(authStateFromClaims(null)).toMatchObject({
      isAuthenticated: false,
      userId: null,
      orgId: null,
    });
  });

  it("builds a user with split names and a primary email", () => {
    const user = userFromClaims(CLAIMS);
    expect(user.firstName).toBe("Ada");
    expect(user.lastName).toBe("Lovelace");
    expect(user.fullName).toBe("Ada Lovelace");
    expect(user.primaryEmailAddress?.emailAddress).toBe("ada@example.test");
    expect(user.hasImage).toBe(false);
  });

  it("builds the active organization only when one is set", () => {
    expect(organizationFromClaims(CLAIMS)).toEqual({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      imageUrl: "",
    });
    expect(organizationFromClaims({ sub: "user-1" })).toBeNull();
  });

  it("matches roles exactly", () => {
    const state = (orgRole: string | null, orgPermissions: string[] = []) => ({
      orgRole,
      orgPermissions,
    });
    expect(hasAccess(state("org:admin"), { role: "org:admin" })).toBe(true);
    expect(hasAccess(state("org:member"), { role: "org:admin" })).toBe(false);
    expect(hasAccess(state(null), { role: "org:admin" })).toBe(false);
  });

  it("grants permissions to owners, listed permissions and nobody else", () => {
    const params = { permission: "member:update" };
    expect(
      hasAccess({ orgRole: "org:owner", orgPermissions: [] }, params)
    ).toBe(true);
    expect(
      hasAccess(
        { orgRole: "org:release", orgPermissions: ["member:update"] },
        params
      )
    ).toBe(true);
    expect(
      hasAccess({ orgRole: "org:admin", orgPermissions: [] }, params)
    ).toBe(false);
    expect(hasAccess({ orgRole: null, orgPermissions: [] }, params)).toBe(
      false
    );
  });
});
