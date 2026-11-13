import "server-only";

/**
 * Whether the deployment accepts open sign-up. Mirrors the api's
 * `AUTH_ALLOW_SIGN_UP` (apps/api/lib/auth/better-auth.ts), which is the actual
 * enforcement: with `false` the api only creates accounts for emails with a
 * pending invitation. The app uses this to hide the sign-up entry points and
 * send unauthenticated visitors to sign-in instead. Read from `process.env` at
 * call time (validated by keys.ts) so a runtime change needs no rebuild.
 */
export function isSignUpAllowed(): boolean {
  return process.env.AUTH_ALLOW_SIGN_UP !== "false";
}

/**
 * Whether signed-in users may create additional organizations. Gates only
 * those: every sign-up gets its own default organization regardless. Mirrors
 * the api's `AUTH_ALLOW_CREATE_ORGANIZATION`.
 */
export function isOrganizationCreationAllowed(): boolean {
  return process.env.AUTH_ALLOW_CREATE_ORGANIZATION === "true";
}
