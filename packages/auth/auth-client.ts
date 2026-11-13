"use client";

import {
  INVITATION_TOKEN_PARAM,
  type InvitationDetails,
  invitationDetailsSchema,
  type SignInMethods,
  type SignInProvider,
  type SsoProviderId,
  signInMethodsSchema,
  signInProvidersSchema,
} from "@repo/api/src/types/auth-account";
import type { OrgPermission } from "@repo/api/src/types/org-permissions";
import {
  fromPermissionStatements,
  toPermissionStatements,
} from "@repo/api/src/types/org-permissions";
import { jwtClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { decodeJwt } from "jose";
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import type { SessionClaims } from "./types";

/**
 * Browser access to the Better Auth endpoints, which the web app serves at
 * `/api/auth/*` (rewritten to apps/api).
 *
 * The session itself lives in an httpOnly cookie. Components read identity
 * from the short-lived JWT minted by `/api/auth/token`, kept in a module-level
 * store: it carries the user and active-organization claims and is the bearer
 * token for apps/api, so one request serves both.
 */

const AUTH_BASE_PATH = "/api/auth";
/** Refresh the JWT this long before it expires. */
const REFRESH_MARGIN_MS = 60_000;

const authClient = createAuthClient({
  baseURL: resolveBaseUrl(),
  basePath: AUTH_BASE_PATH,
  plugins: [
    organizationClient({ dynamicAccessControl: { enabled: true } }),
    jwtClient(),
  ],
});

export type AuthError = { message?: string } | null;
export type AuthResult<T = unknown> = { data: T | null; error: AuthError };

/** A member role: a built-in (`BuiltInOrgRole`) or an owner-defined custom role name. */
export type AuthRoleName = string;

export type AuthErrorDetail = {
  message?: string;
  code?: string;
  status?: number;
};

export type InvitationResult = {
  data: InvitationDetails | null;
  error: AuthErrorDetail | null;
};

export type OrgRoleRecord = {
  id: string;
  role: string;
  permissions: OrgPermission[];
};

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string | null;
  logo?: string | null;
};

export type FullOrganization = {
  id: string;
  name: string;
  members: Array<{
    id: string;
    role: string;
    user: { id: string; name: string; email: string };
  }>;
  invitations: Array<{
    id: string;
    email: string;
    role: string | null;
    status: string;
  }>;
};

/**
 * The Better Auth operations the UI uses, with declared result types (the
 * client's inferred types are not portable across package boundaries).
 */
export const authApi = {
  signInEmail: (input: {
    email: string;
    password: string;
  }): Promise<AuthResult> => authClient.signIn.email(input),
  signUpEmail: (input: {
    name: string;
    email: string;
    password: string;
  }): Promise<AuthResult> => authClient.signUp.email(input),
  requestPasswordReset: (input: {
    email: string;
    redirectTo: string;
  }): Promise<AuthResult> => authClient.requestPasswordReset(input),
  resetPassword: (input: {
    newPassword: string;
    token: string;
  }): Promise<AuthResult> => authClient.resetPassword(input),
  updateUser: (input: { name: string }): Promise<AuthResult> =>
    authClient.updateUser(input),
  changePassword: (input: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions: boolean;
  }): Promise<AuthResult> => authClient.changePassword(input),
  createOrganization: (input: {
    name: string;
    slug: string;
  }): Promise<AuthResult<{ id: string }>> =>
    authClient.organization.create(input),
  getFullOrganization: (): Promise<AuthResult<FullOrganization>> =>
    authClient.organization.getFullOrganization() as Promise<
      AuthResult<FullOrganization>
    >,
  updateOrganization: (input: { name: string }): Promise<AuthResult> =>
    authClient.organization.update({ data: input }),
  inviteMember: (input: {
    email: string;
    role: AuthRoleName;
  }): Promise<AuthResult> => authClient.organization.inviteMember(input),
  updateMemberRole: (input: {
    memberId: string;
    role: AuthRoleName;
  }): Promise<AuthResult> => authClient.organization.updateMemberRole(input),
  removeMember: (memberId: string): Promise<AuthResult> =>
    authClient.organization.removeMember({ memberIdOrEmail: memberId }),
  cancelInvitation: (invitationId: string): Promise<AuthResult> =>
    authClient.organization.cancelInvitation({ invitationId }),
  listRoles: async (): Promise<AuthResult<OrgRoleRecord[]>> => {
    const result = await authClient.organization.listRoles();
    return toRoleListResult(result.data, result.error);
  },
  createRole: (input: {
    role: string;
    permission: OrgPermission[];
  }): Promise<AuthResult> =>
    authClient.organization.createRole({
      role: input.role,
      permission: toPermissionStatements(input.permission),
    }),
  updateRole: (input: {
    roleName: string;
    data: { permission: OrgPermission[] };
  }): Promise<AuthResult> =>
    authClient.organization.updateRole({
      roleName: input.roleName,
      data: { permission: toPermissionStatements(input.data.permission) },
    }),
  deleteRole: (input: { roleName: string }): Promise<AuthResult> =>
    authClient.organization.deleteRole({ roleName: input.roleName }),
  getInvitation: async (
    id: string,
    token: string | null
  ): Promise<InvitationResult> => {
    const result = await authClient.$fetch("/organization/get-invitation", {
      method: "GET",
      query: { id, [INVITATION_TOKEN_PARAM]: token ?? "" },
    });
    if (result.error) {
      return { data: null, error: result.error };
    }
    const parsed = invitationDetailsSchema.safeParse(result.data);
    if (!parsed.success) {
      return {
        data: null,
        error: { message: "Unexpected invitation response" },
      };
    }
    return { data: parsed.data, error: null };
  },
  acceptInvitation: async (
    id: string,
    token: string | null
  ): Promise<AuthResult> => {
    const result = await authClient.$fetch("/organization/accept-invitation", {
      method: "POST",
      body: { invitationId: id, [INVITATION_TOKEN_PARAM]: token ?? "" },
    });
    return parseFetchResult(result, invitationActionResponseSchema);
  },
  rejectInvitation: async (
    id: string,
    token: string | null
  ): Promise<AuthResult> => {
    const result = await authClient.$fetch("/organization/reject-invitation", {
      method: "POST",
      body: { invitationId: id, [INVITATION_TOKEN_PARAM]: token ?? "" },
    });
    return parseFetchResult(result, invitationActionResponseSchema);
  },
  listSignInProviders: async (): Promise<AuthResult<SignInProvider[]>> => {
    const result = await authClient.$fetch("/sign-in-providers", {
      method: "GET",
    });
    return parseFetchResult(result, signInProvidersSchema);
  },
  getSignInMethods: async (): Promise<AuthResult<SignInMethods>> => {
    const result = await authClient.$fetch("/account/sign-in-methods", {
      method: "GET",
    });
    return parseFetchResult(result, signInMethodsSchema);
  },
  setPassword: async (newPassword: string): Promise<AuthResult> => {
    const result = await authClient.$fetch("/account/set-password", {
      method: "POST",
      body: { newPassword },
    });
    return parseFetchResult(result, setPasswordResponseSchema);
  },
  sendVerificationEmail: (input: {
    email: string;
    callbackURL: string;
  }): Promise<AuthResult> => authClient.sendVerificationEmail(input),
  signInSocial: (input: {
    provider: SsoProviderId;
    callbackURL: string;
    errorCallbackURL: string;
    newUserCallbackURL: string;
  }): Promise<AuthResult> => authClient.signIn.social(input),
  linkSocial: (input: {
    provider: SsoProviderId;
    callbackURL: string;
    errorCallbackURL: string;
  }): Promise<AuthResult> => authClient.linkSocial(input),
  unlinkAccount: async (input: {
    providerId: SsoProviderId;
  }): Promise<AuthResult> => {
    // Better Auth 1.7.6 unlinks by the account row id, so resolve it first.
    const accounts = await authClient.listAccounts();
    if (accounts.error) {
      return { data: null, error: accounts.error };
    }
    const account = accounts.data?.find(
      (item) => item.providerId === input.providerId
    );
    if (!account) {
      return { data: null, error: { message: "Account is not connected" } };
    }
    return authClient.unlinkAccount({ accountId: account.id });
  },
};

const setPasswordResponseSchema = z.object({ status: z.boolean() });

const roleListSchema = z.array(
  z.object({
    id: z.string(),
    role: z.string(),
    permission: z.record(z.string(), z.array(z.string())),
  })
);

function toRoleListResult(
  data: unknown,
  error: AuthErrorDetail | null
): AuthResult<OrgRoleRecord[]> {
  if (error) {
    return { data: null, error };
  }
  const parsed = roleListSchema.safeParse(data);
  if (!parsed.success) {
    return { data: null, error: { message: "Unexpected roles response" } };
  }
  return {
    data: parsed.data.map((role) => ({
      id: role.id,
      role: role.role,
      permissions: fromPermissionStatements(role.permission),
    })),
    error: null,
  };
}

function parseFetchResult<T>(
  result: { data: unknown; error: AuthErrorDetail | null },
  schema: z.ZodType<T>
): AuthResult<T> {
  if (result.error) {
    return { data: null, error: result.error };
  }
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return { data: null, error: { message: "Unexpected server response" } };
  }
  return { data: parsed.data, error: null };
}

/** Organizations the signed-in user belongs to. */
export function useOrganizationSummaries(): {
  data: OrganizationSummary[] | null;
  isPending: boolean;
} {
  const { data, isPending } = authClient.useListOrganizations();
  return {
    data: data
      ? data.map((org) => ({
          id: org.id,
          name: org.name,
          slug: org.slug ?? null,
          logo: org.logo ?? null,
        }))
      : null,
    isPending,
  };
}

export type SessionStatus = "loading" | "signed-in" | "signed-out";

export type SessionSnapshot = {
  status: SessionStatus;
  token: string | null;
  claims: SessionClaims | null;
};

const LOADING: SessionSnapshot = {
  status: "loading",
  token: null,
  claims: null,
};
const SIGNED_OUT: SessionSnapshot = {
  status: "signed-out",
  token: null,
  claims: null,
};

let snapshot: SessionSnapshot = LOADING;
let inFlight: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

/** Re-mint the JWT (after sign-in, org switch, profile or slug changes). */
export function refreshSession(): Promise<string | null> {
  inFlight ??= mintToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** A JWT valid for at least a minute, or null when signed out. */
export function getSessionToken(): Promise<string | null> {
  const { token, claims } = snapshot;
  if (
    token &&
    claims?.exp &&
    claims.exp * 1000 - Date.now() > REFRESH_MARGIN_MS
  ) {
    return Promise.resolve(token);
  }
  return refreshSession();
}

const SIGN_IN_PATH = "/sign-in";

type SignOutOptions = { redirectUrl?: string };

export async function signOut(options?: SignOutOptions): Promise<void> {
  await authClient.signOut();
  publish(SIGNED_OUT);
  globalThis.location?.assign(options?.redirectUrl ?? SIGN_IN_PATH);
}

/** Switch the session's active organization and re-mint the JWT. */
export async function setActive(params: {
  organization: string | null;
}): Promise<void> {
  const result = await authClient.organization.setActive({
    organizationId: params.organization,
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Could not switch organization");
  }
  await refreshSession();
}

export function useSessionSnapshot(): SessionSnapshot {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (snapshot.status === "loading") {
      refreshSession().catch(() => undefined);
    }
  }, []);
  return value;
}

async function mintToken(): Promise<string | null> {
  try {
    const result = await authClient.token();
    const token = result.data?.token ?? null;
    if (!token) {
      publish(SIGNED_OUT);
      return null;
    }
    publish({
      status: "signed-in",
      token,
      claims: decodeJwt(token) as SessionClaims,
    });
    return token;
  } catch {
    publish(SIGNED_OUT);
    return null;
  }
}

function publish(next: SessionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SessionSnapshot {
  return snapshot;
}

function getServerSnapshot(): SessionSnapshot {
  return LOADING;
}

function resolveBaseUrl(): string {
  if (globalThis.window !== undefined) {
    return globalThis.window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

const invitationActionResponseSchema = z.object({ invitation: z.unknown() });
