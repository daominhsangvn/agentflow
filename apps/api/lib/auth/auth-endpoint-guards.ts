import { INVITATION_TOKEN_PARAM } from "@repo/api/src/types/auth-account";
import {
  BuiltInOrgRole,
  isGrantableStatementMap,
  splitOrgRoleNames,
} from "@repo/api/src/types/org-permissions";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { z } from "zod";
import { isValidInvitationToken } from "./invitation-token";
import {
  adapterRoleReader,
  checkRoleAssignment,
  RoleAssignmentDenial,
} from "./role-assignment";

/**
 * Guards on Better Auth's own endpoints, registered as plugin hooks. Hooks see
 * the raw, not yet validated input, so each one parses what it reads with zod.
 * No `@repo/database` here: guards read through the Better Auth adapter.
 */

export const AuthEndpointPath = {
  GetInvitation: "/organization/get-invitation",
  AcceptInvitation: "/organization/accept-invitation",
  RejectInvitation: "/organization/reject-invitation",
  InviteMember: "/organization/invite-member",
  UpdateMemberRole: "/organization/update-member-role",
  CreateRole: "/organization/create-role",
  UpdateRole: "/organization/update-role",
  DeleteOrganization: "/organization/delete",
} as const;

const OWNER_ROLE = BuiltInOrgRole.Owner;

const invitationPaths: readonly string[] = [
  AuthEndpointPath.GetInvitation,
  AuthEndpointPath.AcceptInvitation,
  AuthEndpointPath.RejectInvitation,
];

const queryInvitationSchema = z.object({
  id: z.string(),
  [INVITATION_TOKEN_PARAM]: z.unknown(),
});

const bodyInvitationSchema = z.object({
  invitationId: z.string(),
  [INVITATION_TOKEN_PARAM]: z.unknown(),
});

const roleBodySchema = z.object({
  role: z.union([z.string(), z.array(z.string())]),
  organizationId: z.string().optional(),
  memberId: z.string().optional(),
});

const permissionMapSchema = z.record(z.string(), z.array(z.string()));

const createRoleBodySchema = z.object({ permission: permissionMapSchema });

const updateRoleBodySchema = z.object({
  data: z.object({ permission: permissionMapSchema.optional() }).optional(),
});

const deleteOrganizationBodySchema = z.object({ organizationId: z.string() });

const acceptedInvitationSchema = z.object({
  member: z.object({ userId: z.string() }),
});

export function authEndpointGuards(): NonNullable<BetterAuthPlugin["hooks"]> {
  return {
    before: [
      {
        matcher: (ctx) => invitationPaths.includes(ctx.path ?? ""),
        handler: invitationTokenGuard,
      },
      {
        matcher: (ctx) =>
          ctx.path === AuthEndpointPath.InviteMember ||
          ctx.path === AuthEndpointPath.UpdateMemberRole,
        handler: roleAssignmentGuard,
      },
      {
        matcher: (ctx) =>
          ctx.path === AuthEndpointPath.CreateRole ||
          ctx.path === AuthEndpointPath.UpdateRole,
        handler: grantablePermissionGuard,
      },
      {
        matcher: (ctx) => ctx.path === AuthEndpointPath.DeleteOrganization,
        handler: ownerOnlyDeleteGuard,
      },
    ],
    after: [
      {
        matcher: (ctx) => ctx.path === AuthEndpointPath.AcceptInvitation,
        handler: verifyEmailOnAcceptedInvitation,
      },
    ],
  };
}

const invitationTokenGuard = createAuthMiddleware((ctx) => {
  const target =
    ctx.path === AuthEndpointPath.GetInvitation
      ? readInvitationQuery(ctx.query)
      : readInvitationBody(ctx.body);
  if (!(target && isValidInvitationToken(target.id, target.token))) {
    throw new APIError("BAD_REQUEST", {
      message: "Invitation not found!",
      code: "INVITATION_NOT_FOUND",
    });
  }
  return Promise.resolve();
});

// Better Auth's own checks cover the creator role only (A26); a caller must
// also hold every permission of the role they give.
const roleAssignmentGuard = createAuthMiddleware(async (ctx) => {
  const parsed = roleBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    throw new APIError("BAD_REQUEST");
  }
  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }
  const organizationId =
    parsed.data.organizationId ?? session.session.activeOrganizationId;
  if (!organizationId) {
    return;
  }
  const { role, memberId } = parsed.data;
  const denial = await checkRoleAssignment(
    adapterRoleReader(ctx.context.adapter),
    {
      organizationId,
      callerUserId: session.user.id,
      targetRole: Array.isArray(role) ? role.join(",") : role,
      memberId:
        ctx.path === AuthEndpointPath.UpdateMemberRole ? memberId : undefined,
    }
  );
  if (denial) {
    throw new APIError("FORBIDDEN", {
      code: "ROLE_NOT_ASSIGNABLE",
      message:
        denial === RoleAssignmentDenial.OwnRole
          ? "You cannot change your own role"
          : "You cannot assign a role with permissions you do not have",
    });
  }
});

// Owner-only statements are never grantable to a custom role (A27).
const grantablePermissionGuard = createAuthMiddleware((ctx) => {
  const permission = readRolePermission(ctx.path, ctx.body);
  if (permission && !isGrantableStatementMap(permission)) {
    throw new APIError("BAD_REQUEST", {
      code: "PERMISSION_NOT_GRANTABLE",
      message: "This permission cannot be granted to a custom role",
    });
  }
  return Promise.resolve();
});

// Deleting the organization is owner-only, whatever a custom role holds (A27).
const ownerOnlyDeleteGuard = createAuthMiddleware(async (ctx) => {
  const session = await getSessionFromCtx(ctx);
  const body = deleteOrganizationBodySchema.safeParse(ctx.body);
  if (!(session && body.success)) {
    return;
  }
  const member = await adapterRoleReader(ctx.context.adapter).findMemberRole(
    body.data.organizationId,
    session.user.id
  );
  if (!member || splitOrgRoleNames(member.role).includes(OWNER_ROLE)) {
    return;
  }
  throw new APIError("FORBIDDEN", {
    code: "OWNER_ONLY",
    message: "Only the owner can delete the organization",
  });
});

// Runs only after `invitationTokenGuard` passed, so the user proved the
// mailbox (A25). Better Auth already checked that the session email equals
// the invitation email.
const verifyEmailOnAcceptedInvitation = createAuthMiddleware(async (ctx) => {
  const parsed = acceptedInvitationSchema.safeParse(ctx.context.returned);
  if (!parsed.success) {
    return;
  }
  await ctx.context.internalAdapter.updateUser(parsed.data.member.userId, {
    emailVerified: true,
  });
});

function readInvitationQuery(
  query: unknown
): { id: string; token: unknown } | null {
  const parsed = queryInvitationSchema.safeParse(query);
  return parsed.success
    ? { id: parsed.data.id, token: parsed.data[INVITATION_TOKEN_PARAM] }
    : null;
}

function readInvitationBody(
  body: unknown
): { id: string; token: unknown } | null {
  const parsed = bodyInvitationSchema.safeParse(body);
  return parsed.success
    ? {
        id: parsed.data.invitationId,
        token: parsed.data[INVITATION_TOKEN_PARAM],
      }
    : null;
}

function readRolePermission(
  path: string | undefined,
  body: unknown
): Record<string, string[]> | undefined {
  if (path === AuthEndpointPath.CreateRole) {
    const parsed = createRoleBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new APIError("BAD_REQUEST");
    }
    return parsed.data.permission;
  }
  const parsed = updateRoleBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new APIError("BAD_REQUEST");
  }
  return parsed.data.data?.permission;
}
