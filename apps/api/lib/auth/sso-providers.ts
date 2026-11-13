import { SsoProviderId } from "@repo/api/src/types/auth-account";
import type { BetterAuthOptions } from "better-auth";
import type { MicrosoftEntraIDProfile } from "better-auth/social-providers";

/**
 * Platform-wide SSO providers, enabled by env on apps/api (A16). A provider is
 * configured only when its client id and secret are both set. Every provider
 * entry must set `disableIdTokenSignIn: true` (A28): only the redirect flow,
 * whose callback runs our verified-email rules, is supported.
 */

type SocialProviders = NonNullable<BetterAuthOptions["socialProviders"]>;
type ProviderOptions = SocialProviders[keyof SocialProviders];

type SsoEnv = Record<string, string | undefined>;

export const MICROSOFT_MULTI_TENANT_IDS = [
  "common",
  "organizations",
  "consumers",
] as const;

const DEFAULT_MICROSOFT_TENANT = "common";

export const SSO_PROVIDER_REGISTRY: Record<
  SsoProviderId,
  { readConfig(env: SsoEnv): ProviderOptions | null }
> = {
  [SsoProviderId.Microsoft]: {
    readConfig(env) {
      const clientId = env.AUTH_MICROSOFT_CLIENT_ID;
      const clientSecret = env.AUTH_MICROSOFT_CLIENT_SECRET;
      if (!(clientId && clientSecret)) {
        return null;
      }
      const tenantId = env.AUTH_MICROSOFT_TENANT_ID || DEFAULT_MICROSOFT_TENANT;
      return {
        clientId,
        clientSecret,
        tenantId,
        prompt: "select_account",
        // A28: `/sign-in/social` and `/link-social` with an `idToken` bypass the
        // callback; refuse them (404 ID_TOKEN_NOT_SUPPORTED).
        disableIdTokenSignIn: true,
        mapProfileToUser: (profile: MicrosoftEntraIDProfile) => ({
          emailVerified: isMicrosoftEmailVerified(profile, tenantId),
        }),
      };
    },
  },
};

export function configuredSsoProviderIds(
  env: SsoEnv = process.env
): SsoProviderId[] {
  return Object.values(SsoProviderId).filter(
    (id) => SSO_PROVIDER_REGISTRY[id].readConfig(env) !== null
  );
}

export function buildSocialProviders(
  env: SsoEnv = process.env
): SocialProviders {
  const providers: Record<string, ProviderOptions> = {};
  for (const id of Object.values(SsoProviderId)) {
    const config = SSO_PROVIDER_REGISTRY[id].readConfig(env);
    if (config) {
      providers[id] = config;
    }
  }
  return providers as SocialProviders;
}

/**
 * A21 rule 1. The email must be asserted verified by Microsoft, and either
 * Microsoft says the tenant owns the email's domain (`xms_edov`) or the
 * operator pinned one specific tenant. Guards against "nOAuth": in a
 * multi-tenant app a foreign tenant can set any `email` value.
 */
export function isMicrosoftEmailVerified(
  profile: Partial<
    Pick<
      MicrosoftEntraIDProfile,
      | "email"
      | "email_verified"
      | "verified_primary_email"
      | "verified_secondary_email"
      | "xms_edov"
    >
  >,
  tenantId: string
): boolean {
  const email = profile.email?.toLowerCase();
  if (!email) {
    return false;
  }
  const listed = [
    ...(profile.verified_primary_email ?? []),
    ...(profile.verified_secondary_email ?? []),
  ].some((item) => item.toLowerCase() === email);
  const asserted = profile.email_verified === true || listed;
  if (!asserted) {
    return false;
  }
  const pinnedTenant = !(
    MICROSOFT_MULTI_TENANT_IDS as readonly string[]
  ).includes(tenantId.toLowerCase());
  return profile.xms_edov === true || pinnedTenant;
}
