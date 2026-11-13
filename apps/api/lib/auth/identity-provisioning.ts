import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import { InvitationStatus } from "@repo/api/src/types/auth-account";
import { BuiltInOrgRole } from "@repo/api/src/types/org-permissions";
import { orgSlugSchema } from "@repo/api/src/types/reserved-slugs";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { organizationsService } from "@/app/organizations/service";
import { usersService } from "@/app/users/service";
import { getPrismaErrorCode } from "@/lib/db-utils";
import { splitDisplayName } from "./identity-service";

/**
 * Membership provisioning and application-table sync for Better Auth.
 *
 * Every new account (password or SSO) becomes the owner of its own default
 * organization and goes through onboarding for it. The first account on an
 * empty install keeps the deployment's organization name/slug
 * (`AUTH_DEFAULT_ORGANIZATION_NAME`/`_SLUG`); later accounts get
 * "<first name>'s organization". Pending invitations are never auto-accepted:
 * the person joins the inviting organization by accepting the invitation.
 *
 * The application's own `users`/`organizations` rows are still created lazily
 * on first API request (`findOrCreateUser`); the hooks below only propagate
 * later profile changes and removals, which the Clerk webhooks used to do.
 */

const DEFAULT_ORGANIZATION_NAME = "AgentFlow";
const DEFAULT_ORGANIZATION_SLUG = "agentflow";
const MAX_DEFAULT_ORGANIZATION_ATTEMPTS = 3;
const SLUG_SUFFIX_LENGTH = 4;
const SLUG_SUFFIX_RADIX = 36;
const FALLBACK_SLUG_LENGTH = 8;

type IdentityUserRecord = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};
type IdentityOrganizationRecord = { id: string; name: string; slug: string };

export async function provisionNewUser(
  user: IdentityUserRecord
): Promise<void> {
  await createDefaultOrganizationWithRetry(user);
  await activateDefaultOrganization(user.id);
}

/**
 * Better Auth creates the sign-up session before the user-created hook runs,
 * so that session starts without an active organization. Point every such
 * session of this user at their default organization.
 */
async function activateDefaultOrganization(userId: string): Promise<void> {
  const organizationId = await defaultActiveOrganizationId(userId);
  if (!organizationId) {
    return;
  }
  await withDb((db) =>
    db.authSession.updateMany({
      where: { userId, activeOrganizationId: null },
      data: { activeOrganizationId: organizationId },
    })
  );
}

/** Whether an unexpired invitation is waiting for this email address. */
export async function hasPendingInvitation(email: string): Promise<boolean> {
  const invitation = await withDb((db) =>
    db.authInvitation.findFirst({
      where: {
        email: email.toLowerCase(),
        status: InvitationStatus.Pending,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    })
  );
  return invitation !== null;
}

/** The organization a new session starts in: the user's oldest membership. */
export async function defaultActiveOrganizationId(
  userId: string
): Promise<string | null> {
  const member = await withDb((db) =>
    db.authMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    })
  );
  return member?.organizationId ?? null;
}

export async function syncUserProfile(user: IdentityUserRecord): Promise<void> {
  const { firstName, lastName } = splitDisplayName(user.name);
  await usersService.updateByClerkId(user.id, {
    email: user.email,
    firstName,
    lastName,
    avatarUrl: user.image ?? null,
  });
}

export async function syncOrganizationUpdate(
  organization: IdentityOrganizationRecord | null
): Promise<void> {
  if (!organization) {
    return;
  }
  const existing = await organizationsService.findByClerkId(organization.id);
  if (!existing) {
    return;
  }
  await organizationsService.updateByClerkId(organization.id, {
    name: organization.name,
    slug: organization.slug,
  });
}

export async function syncOrganizationDeleted(
  organizationId: string
): Promise<void> {
  const existing = await organizationsService.findByClerkId(organizationId);
  if (existing) {
    await organizationsService.deactivateByClerkId(organizationId);
  }
}

export async function syncMemberAdded(
  user: IdentityUserRecord,
  organization: IdentityOrganizationRecord
): Promise<void> {
  const localOrganization = await organizationsService.findOrCreateByClerkId(
    organization.id,
    { name: organization.name, slug: organization.slug }
  );
  const { firstName, lastName } = splitDisplayName(user.name);
  await usersService.upsertByClerkIdAndOrg({
    clerkId: user.id,
    organizationId: localOrganization.id,
    email: user.email,
    firstName,
    lastName,
    avatarUrl: user.image ?? null,
  });
}

export async function syncMemberRemoved(
  userId: string,
  organizationId: string
): Promise<void> {
  const localOrganization =
    await organizationsService.findByClerkId(organizationId);
  if (!localOrganization) {
    return;
  }
  try {
    await usersService.deactivateByClerkIdAndOrg(userId, localOrganization.id);
  } catch (error) {
    if (getPrismaErrorCode(error) !== "P2025") {
      throw error;
    }
    log.info("[identity] removed member had no application user row", {
      userId,
      organizationId: localOrganization.id,
    });
  }
}

/**
 * Retries in a fresh transaction on a unique-constraint failure (slug
 * collision, or the empty-install race where the loser takes the personal
 * branch on the next attempt). Never keeps querying in a failed transaction.
 */
async function createDefaultOrganizationWithRetry(
  user: IdentityUserRecord
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await createDefaultOrganization(user);
      return;
    } catch (error) {
      if (
        getPrismaErrorCode(error) !== "P2002" ||
        attempt >= MAX_DEFAULT_ORGANIZATION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}

async function createDefaultOrganization(
  user: IdentityUserRecord
): Promise<void> {
  const now = new Date();
  await withDb.tx(async (tx) => {
    const existing = await tx.authOrganization.findFirst({
      select: { id: true },
    });
    const details = existing
      ? personalOrganizationDetails(user)
      : installOrganizationDetails();
    const organization = await tx.authOrganization.create({
      data: { id: randomUUID(), ...details, createdAt: now },
      select: { id: true },
    });
    await tx.authMember.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        userId: user.id,
        role: BuiltInOrgRole.Owner,
        createdAt: now,
      },
    });
    log.info("[identity] created the default organization", {
      organizationId: organization.id,
      ownerUserId: user.id,
    });
  });
}

/** Marks an account email as verified (the user proved control of the mailbox). */
export async function markEmailVerified(userId: string): Promise<void> {
  await withDb((db) =>
    db.authUser.updateMany({
      where: { id: userId, emailVerified: false },
      data: { emailVerified: true },
    })
  );
}

function installOrganizationDetails(): { name: string; slug: string } {
  return {
    name:
      process.env.AUTH_DEFAULT_ORGANIZATION_NAME || DEFAULT_ORGANIZATION_NAME,
    slug:
      process.env.AUTH_DEFAULT_ORGANIZATION_SLUG || DEFAULT_ORGANIZATION_SLUG,
  };
}

function personalOrganizationDetails(user: IdentityUserRecord): {
  name: string;
  slug: string;
} {
  const localPart = user.email.split("@")[0] ?? "";
  const firstName = splitDisplayName(user.name).firstName || localPart;
  return {
    name: `${firstName}'s organization`,
    slug: defaultOrganizationSlug(user.email),
  };
}

function defaultOrganizationSlug(email: string): string {
  const localPart = (email.split("@")[0] ?? "").toLowerCase();
  const base = localPart
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .padEnd(2, "x");
  const suffix = Array.from({ length: SLUG_SUFFIX_LENGTH }, () =>
    randomInt(SLUG_SUFFIX_RADIX).toString(SLUG_SUFFIX_RADIX)
  ).join("");
  const slug = `${base}-${suffix}`;
  return orgSlugSchema.safeParse(slug).success ? slug : fallbackSlug();
}

function fallbackSlug(): string {
  const suffix = Array.from({ length: FALLBACK_SLUG_LENGTH }, () =>
    randomInt(SLUG_SUFFIX_RADIX).toString(SLUG_SUFFIX_RADIX)
  ).join("");
  return `org-${suffix}`;
}
