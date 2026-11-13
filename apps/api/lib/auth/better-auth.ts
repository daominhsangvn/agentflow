import "server-only";

import { randomUUID } from "node:crypto";
import { orgSlugSchema } from "@repo/api/src/types/reserved-slugs";
import { getPrismaClient, withDb } from "@repo/database";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins/jwt";
import { organization } from "better-auth/plugins/organization";
import { ac, orgRoles } from "./access-control";
import { agentflowAuthPlugin } from "./agentflow-auth-plugin";
import {
  appBaseUrl,
  sendEmailVerificationEmail,
  sendInvitationEmail,
  sendPasswordResetEmail,
} from "./auth-email";
import { runAsFirstAdminSignUp } from "./first-admin-sign-up";
import {
  defaultActiveOrganizationId,
  markEmailVerified,
  provisionNewUser,
  syncMemberAdded,
  syncMemberRemoved,
  syncOrganizationDeleted,
  syncOrganizationUpdate,
  syncUserProfile,
} from "./identity-provisioning";
import { toOrgRole } from "./identity-service";
import { resolveMemberPermissions } from "./org-permissions";
import { buildSocialProviders } from "./sso-providers";
import { beforeUserCreate } from "./user-create-guard";

/**
 * The identity provider: email/password accounts, organizations, and the
 * short-lived JWTs the web app sends to this API (`Authorization: Bearer`).
 *
 * Mounted at `/api/auth/*` (app/api/auth/[...all]/route.ts). Browsers reach it
 * through the web app, which rewrites `/api/auth/*` here, so its cookies are
 * first-party to the web app origin (`BETTER_AUTH_URL`).
 *
 * JWT claims mirror what the code previously read from Clerk session tokens:
 * `sub` (user id), `org_id`, `org_slug`, `org_role` (`org:owner|admin|member`).
 */

const TOKEN_LIFETIME = "15m";
const MIN_PASSWORD_LENGTH = 8;
/** Matches the "expires in 7 days" promise in the invitation email. */
const INVITATION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export const AUTH_BASE_PATH = "/api/auth";

const betterAuthServer = betterAuth({
  appName: "AgentFlow",
  baseURL: appBaseUrl(),
  basePath: AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: trustedOrigins(),
  database: prismaAdapter(getPrismaClient(), { provider: "postgresql" }),
  advanced: {
    cookiePrefix: "agentflow",
    // Ids are generated here: the auth_* tables have no column defaults.
    database: { generateId: () => randomUUID() },
  },
  // Listing invitations by session email would expose another person's
  // invitations to whoever signs up with their address (A8).
  disabledPaths: ["/organization/list-user-invitations"],
  user: { modelName: "authUser" },
  session: { modelName: "authSession" },
  socialProviders: buildSocialProviders(),
  // A21: accounts join by email only when both sides proved the mailbox. No
  // `trustedProviders`; a provider email counts only as the registry's
  // `mapProfileToUser` says (Microsoft: `isMicrosoftEmailVerified`).
  account: {
    modelName: "authAccount",
    accountLinking: {
      enabled: true,
      disableImplicitLinking: false,
      requireLocalEmailVerified: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    },
  },
  verification: { modelName: "authVerification" },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) =>
      sendEmailVerificationEmail({ email: user.email, url }),
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    sendResetPassword: ({ user, url }) =>
      sendPasswordResetEmail({ email: user.email, url }),
    onPasswordReset: ({ user }) => markEmailVerified(user.id),
  },
  databaseHooks: {
    user: {
      create: {
        before: beforeUserCreate,
        after: (user) => provisionNewUser(user),
      },
      update: { after: (user) => syncUserProfile(user) },
    },
    session: {
      create: {
        before: async (session) => ({
          data: {
            ...session,
            activeOrganizationId:
              session.activeOrganizationId ??
              (await defaultActiveOrganizationId(session.userId)),
          },
        }),
      },
    },
  },
  plugins: [
    organization({
      ac,
      roles: orgRoles,
      dynamicAccessControl: { enabled: true },
      invitationExpiresIn: INVITATION_LIFETIME_SECONDS,
      allowUserToCreateOrganization:
        process.env.AUTH_ALLOW_CREATE_ORGANIZATION === "true",
      schema: {
        organization: { modelName: "authOrganization" },
        member: { modelName: "authMember" },
        invitation: { modelName: "authInvitation" },
        organizationRole: { modelName: "authOrganizationRole" },
      },
      // Ids are visible to org members, so the signed link token proves the
      // mailbox (A25, see auth-endpoint-guards.ts). Better Auth's verified-email
      // rule for custom `generateId` would strand freshly signed-up invitees.
      requireEmailVerificationOnInvitation: false,
      sendInvitationEmail: ({
        id,
        role,
        email,
        organization: invitedTo,
        inviter,
      }) =>
        sendInvitationEmail({
          invitationId: id,
          role,
          email,
          organizationName: invitedTo.name,
          inviterName: inviter.user.name || inviter.user.email,
        }),
      organizationHooks: {
        beforeCreateOrganization: ({ organization: draft }) => {
          if (!orgSlugSchema.safeParse(draft.slug).success) {
            throw new APIError("BAD_REQUEST", {
              message: "Organization slug is invalid or reserved",
            });
          }
          return Promise.resolve();
        },
        afterUpdateOrganization: ({ organization: updated }) =>
          syncOrganizationUpdate(updated),
        afterDeleteOrganization: ({ organization: deleted }) =>
          syncOrganizationDeleted(deleted.id),
        // A re-invited, deactivated user is reactivated. Email verification on
        // accept is done by the token guard (A25).
        afterAcceptInvitation: ({ user, organization: joined }) =>
          syncMemberAdded(user, joined),
        afterAddMember: ({ user, organization: joined }) =>
          syncMemberAdded(user, joined),
        afterRemoveMember: ({ user, organization: left }) =>
          syncMemberRemoved(user.id, left.id),
      },
    }),
    agentflowAuthPlugin(),
    jwt({
      schema: { jwks: { modelName: "authJwks" } },
      jwt: {
        issuer: appBaseUrl(),
        audience: appBaseUrl(),
        expirationTime: TOKEN_LIFETIME,
        definePayload: async ({ user, session }) =>
          buildTokenClaims(
            user,
            session.activeOrganizationId ??
              (await defaultActiveOrganizationId(user.id))
          ),
      },
    }),
  ],
});

/** Request handler for the `/api/auth/*` route. */
export const betterAuthHandler: (request: Request) => Promise<Response> =
  betterAuthServer.handler;

async function buildTokenClaims(
  user: { id: string; email: string; name: string; image?: string | null },
  activeOrganizationId: string | null
): Promise<Record<string, unknown>> {
  const claims: Record<string, unknown> = {
    email: user.email,
    name: user.name,
    image: user.image ?? null,
  };
  if (!activeOrganizationId) {
    return claims;
  }
  const member = await withDb((db) =>
    db.authMember.findFirst({
      where: { organizationId: activeOrganizationId, userId: user.id },
      select: {
        role: true,
        organization: { select: { name: true, slug: true, logo: true } },
      },
    })
  );
  if (!member) {
    return claims;
  }
  return {
    ...claims,
    org_id: activeOrganizationId,
    org_slug: member.organization.slug,
    org_name: member.organization.name,
    org_logo: member.organization.logo,
    org_role: toOrgRole(member.role),
    org_permissions: await resolveMemberPermissions(
      member.role,
      activeOrganizationId
    ),
  };
}

function trustedOrigins(): string[] {
  const extra = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [new URL(appBaseUrl()).origin, ...extra];
}

/**
 * Create the first account through the normal Better Auth sign-up, so the
 * `after` hook provisions the default organization and owner membership.
 * Bypasses `AUTH_ALLOW_SIGN_UP=false` for this one call only. The caller must
 * guarantee no user exists yet.
 */
export async function createFirstAdminAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  const result = await runAsFirstAdminSignUp(() =>
    betterAuthServer.api.signUpEmail({ body: input })
  );
  return { userId: result.user.id };
}
