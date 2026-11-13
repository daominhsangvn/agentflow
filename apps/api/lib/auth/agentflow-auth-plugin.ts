import {
  CREDENTIAL_PROVIDER_ID,
  type SignInMethods,
  type SignInProvider,
  SSO_PROVIDER_LABELS,
  type SsoProviderId,
} from "@repo/api/src/types/auth-account";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from "better-auth/api";
import { z } from "zod";
import { authEndpointGuards } from "./auth-endpoint-guards";
import { configuredSsoProviderIds } from "./sso-providers";

/**
 * AgentFlow's own browser-facing auth endpoints, mounted under `/api/auth`
 * with the same cookie session as Better Auth: which sign-in providers exist,
 * which sign-in methods the signed-in user has, and set-password for accounts
 * created through SSO.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

type AccountRecord = { providerId: string };

type CredentialAdapter = {
  findAccounts(userId: string): Promise<AccountRecord[]>;
  linkAccount(data: {
    userId: string;
    providerId: string;
    accountId: string;
    password: string;
  }): Promise<unknown>;
};

const setPasswordBodySchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

export function agentflowAuthPlugin(): BetterAuthPlugin {
  return {
    id: "agentflow",
    hooks: authEndpointGuards(),
    endpoints: {
      signInProviders: createAuthEndpoint(
        "/sign-in-providers",
        { method: "GET" },
        (ctx) => ctx.json(listSignInProviders())
      ),
      signInMethods: createAuthEndpoint(
        "/account/sign-in-methods",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const session = ctx.context.session;
          const accounts = await ctx.context.internalAdapter.findAccounts(
            session.user.id
          );
          return ctx.json(
            toSignInMethods({
              accounts,
              emailVerified: session.user.emailVerified,
              configuredProviders: configuredSsoProviderIds(),
            })
          );
        }
      ),
      setPassword: createAuthEndpoint(
        "/account/set-password",
        {
          method: "POST",
          body: setPasswordBodySchema,
          use: [sessionMiddleware],
        },
        async (ctx) => {
          await setCredentialPassword(
            ctx.context.internalAdapter,
            ctx.context.session.user.id,
            ctx.body.newPassword,
            (password) => ctx.context.password.hash(password)
          );
          return ctx.json({ status: true });
        }
      ),
    },
  };
}

export function listSignInProviders(
  configured: SsoProviderId[] = configuredSsoProviderIds()
): SignInProvider[] {
  return configured.map((id) => ({ id, label: SSO_PROVIDER_LABELS[id] }));
}

export function toSignInMethods(params: {
  accounts: AccountRecord[];
  emailVerified: boolean;
  configuredProviders: SsoProviderId[];
}): SignInMethods {
  const linkedIds = new Set(params.accounts.map((a) => a.providerId));
  return {
    hasPassword: linkedIds.has(CREDENTIAL_PROVIDER_ID),
    emailVerified: params.emailVerified,
    providers: params.configuredProviders.map((id) => ({
      id,
      label: SSO_PROVIDER_LABELS[id],
      linked: linkedIds.has(id),
    })),
  };
}

/**
 * Adds a password to an account that has none (an SSO-only account).
 * Mirrors Better Auth's own `setPassword`.
 */
export async function setCredentialPassword(
  adapter: CredentialAdapter,
  userId: string,
  newPassword: string,
  hash: (password: string) => Promise<string>
): Promise<void> {
  const accounts = await adapter.findAccounts(userId);
  if (accounts.some((a) => a.providerId === CREDENTIAL_PROVIDER_ID)) {
    throw new APIError("BAD_REQUEST", {
      message: "This account already has a password",
    });
  }
  await adapter.linkAccount({
    userId,
    providerId: CREDENTIAL_PROVIDER_ID,
    accountId: userId,
    password: await hash(newPassword),
  });
}
