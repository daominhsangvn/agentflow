import { BuiltInOrgRole } from "@repo/api/src/types/org-permissions";

/**
 * Identity shapes shared by the server, middleware and client entry points.
 *
 * They deliberately keep the field names the app was written against when it
 * used Clerk (`userId`, `orgId`, `orgSlug`, `orgRole`, `primaryEmailAddress`,
 * ...), so call sites did not have to change when the provider moved to Better
 * Auth. Values come from the Better Auth JWT issued by apps/api.
 */

/** Claims of the JWT minted by apps/api/lib/auth/better-auth.ts. */
export type SessionClaims = {
  sub: string;
  email?: string;
  name?: string;
  image?: string | null;
  org_id?: string;
  org_slug?: string;
  org_name?: string;
  org_logo?: string | null;
  /** `org:owner`, `org:admin` or `org:member`. */
  org_role?: string;
  /** Grantable permissions of the member's role. UI hint only, up to 15 minutes stale. */
  org_permissions?: string[];
  exp?: number;
  iat?: number;
  iss?: string;
};

export type AuthEmailAddress = { id: string; emailAddress: string };

export type AuthUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  username: null;
  imageUrl: string;
  hasImage: boolean;
  primaryEmailAddressId: string | null;
  primaryEmailAddress: AuthEmailAddress | null;
  emailAddresses: AuthEmailAddress[];
  /** Not carried by the session JWT; kept for Clerk-shaped consumers. */
  createdAt: Date | null;
  /** Not carried by the session JWT; kept for Clerk-shaped consumers. */
  lastSignInAt: Date | null;
};

export type AuthOrganization = {
  id: string;
  name: string;
  slug: string | null;
  imageUrl: string;
};

export type HasParams = { role: string } | { permission: string };

export type AuthState = {
  isAuthenticated: boolean;
  userId: string | null;
  sessionId: string | null;
  orgId: string | null;
  orgSlug: string | null;
  orgRole: string | null;
  orgPermissions: string[];
  sessionClaims: SessionClaims | null;
};

export function authStateFromClaims(claims: SessionClaims | null): AuthState {
  if (!claims) {
    return {
      isAuthenticated: false,
      userId: null,
      sessionId: null,
      orgId: null,
      orgSlug: null,
      orgRole: null,
      orgPermissions: [],
      sessionClaims: null,
    };
  }
  return {
    isAuthenticated: true,
    userId: claims.sub,
    sessionId: null,
    orgId: claims.org_id ?? null,
    orgSlug: claims.org_slug ?? null,
    orgRole: claims.org_role ?? null,
    orgPermissions: claims.org_permissions ?? [],
    sessionClaims: claims,
  };
}

export function userFromClaims(claims: SessionClaims): AuthUser {
  const fullName = claims.name?.trim() || null;
  const separator = fullName ? fullName.indexOf(" ") : -1;
  const firstName =
    fullName && separator > 0 ? fullName.slice(0, separator) : fullName;
  const lastName =
    fullName && separator > 0
      ? fullName.slice(separator + 1).trim() || null
      : null;
  const email = claims.email
    ? { id: `${claims.sub}:email`, emailAddress: claims.email }
    : null;
  return {
    id: claims.sub,
    firstName,
    lastName,
    fullName,
    username: null,
    imageUrl: claims.image ?? "",
    hasImage: Boolean(claims.image),
    primaryEmailAddressId: email?.id ?? null,
    primaryEmailAddress: email,
    emailAddresses: email ? [email] : [],
    createdAt: null,
    lastSignInAt: null,
  };
}

export function organizationFromClaims(
  claims: SessionClaims | null
): AuthOrganization | null {
  if (!claims?.org_id) {
    return null;
  }
  return {
    id: claims.org_id,
    name: claims.org_name ?? claims.org_slug ?? "",
    slug: claims.org_slug ?? null,
    imageUrl: claims.org_logo ?? "",
  };
}

const OWNER_ORG_ROLE = `org:${BuiltInOrgRole.Owner}`;

/**
 * Role check with the semantics the app relies on: an exact role match. A
 * permission check passes for the owner role, or when the session claim lists
 * the permission.
 */
export function hasAccess(
  state: Pick<AuthState, "orgRole" | "orgPermissions">,
  params: HasParams
): boolean {
  if ("role" in params) {
    return state.orgRole !== null && params.role === state.orgRole;
  }
  return (
    state.orgRole === OWNER_ORG_ROLE ||
    state.orgPermissions.includes(params.permission)
  );
}
