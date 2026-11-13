import "server-only";

import {
  isSsoProviderId,
  SSO_PROVIDER_LABELS,
} from "@repo/api/src/types/auth-account";
import { APIError } from "better-auth/api";
import { isFirstAdminSignUp } from "./first-admin-sign-up";
import { hasPendingInvitation } from "./identity-provisioning";

/** Path of Better Auth's email/password sign-up (also `api.signUpEmail`). */
const PASSWORD_SIGN_UP_PATH = "/sign-up/email";

export type UserCreateContext = {
  path?: string;
  params?: Record<string, string | undefined>;
} | null;

/**
 * `AUTH_ALLOW_SIGN_UP=false` makes the deployment invite-only: an account can
 * still be created for an email with a pending invitation (also for SSO, A20).
 * Every creation path except the password sign-up needs a verified email
 * (A21 rule 3, A28), so an unverified identity cannot squat an address:
 * OAuth callback, id-token sign-in and any other social path. Password
 * accounts stay unverified until email verification or an accepted invitation.
 */
export async function beforeUserCreate(
  user: { email: string; emailVerified?: boolean | null },
  ctx?: UserCreateContext
): Promise<void> {
  if (await isSignUpBlocked(user.email)) {
    throw new APIError("FORBIDDEN", {
      message: "Sign-up is by invitation only",
    });
  }
  if (ctx?.path === PASSWORD_SIGN_UP_PATH) {
    return;
  }
  if (user.emailVerified !== true) {
    throw new APIError("FORBIDDEN", { message: unverifiedMessage(ctx) });
  }
}

export async function isSignUpBlocked(email: string): Promise<boolean> {
  if (process.env.AUTH_ALLOW_SIGN_UP !== "false") {
    return false;
  }
  if (isFirstAdminSignUp()) {
    return false;
  }
  return !(await hasPendingInvitation(email));
}

function unverifiedMessage(ctx: UserCreateContext | undefined): string {
  const providerId = ctx?.params?.id;
  if (providerId !== undefined && isSsoProviderId(providerId)) {
    return `Your ${SSO_PROVIDER_LABELS[providerId]} account has no verified email address`;
  }
  return "A verified email address is required to create an account";
}
