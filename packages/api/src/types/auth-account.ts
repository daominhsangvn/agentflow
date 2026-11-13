import { z } from "zod";

/** Platform-wide SSO providers, enabled by env on apps/api. */
export const SsoProviderId = {
  Microsoft: "microsoft",
} as const;
export type SsoProviderId = (typeof SsoProviderId)[keyof typeof SsoProviderId];

export const SSO_PROVIDER_LABELS: Record<SsoProviderId, string> = {
  [SsoProviderId.Microsoft]: "Microsoft",
};

const ssoProviderIdSet = new Set<string>(Object.values(SsoProviderId));

export function isSsoProviderId(value: string): value is SsoProviderId {
  return ssoProviderIdSet.has(value);
}

/** Better Auth's provider id for the email/password account. */
export const CREDENTIAL_PROVIDER_ID = "credential";

export const signInProviderSchema = z.object({
  id: z.enum(SsoProviderId),
  label: z.string(),
});
export type SignInProvider = z.infer<typeof signInProviderSchema>;

export const signInProvidersSchema = z.array(signInProviderSchema);

export const signInMethodsSchema = z.object({
  hasPassword: z.boolean(),
  emailVerified: z.boolean(),
  providers: z.array(
    z.object({
      id: z.enum(SsoProviderId),
      label: z.string(),
      linked: z.boolean(),
    })
  ),
});
export type SignInMethods = z.infer<typeof signInMethodsSchema>;

/** Invitation statuses stored by Better Auth. */
export const InvitationStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Rejected: "rejected",
  Canceled: "canceled",
} as const;
export type InvitationStatus =
  (typeof InvitationStatus)[keyof typeof InvitationStatus];

/**
 * Shape of Better Auth's `GET /organization/get-invitation`. The Better Auth
 * client revives ISO strings into `Date`, so `expiresAt` accepts both and the
 * parsed output is an ISO string.
 */
export const invitationDetailsSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  organizationSlug: z.string(),
  inviterEmail: z.string(),
  status: z.enum(InvitationStatus),
  expiresAt: z
    .union([z.string(), z.date()])
    .transform((value) =>
      value instanceof Date ? value.toISOString() : value
    ),
});
export type InvitationDetails = z.infer<typeof invitationDetailsSchema>;

/** `?error=` values the sign-in page maps to messages (Better Auth OAuth callback). */
export const SignInErrorCode = {
  AccountNotLinked: "account_not_linked",
  EmailNotVerified: "email_not_verified",
  SignupDisabled: "signup_disabled",
  UnableToCreateUser: "unable_to_create_user",
  UnableToLinkAccount: "unable_to_link_account",
  EmailDoesNotMatch: "email_does_not_match",
  EmailNotFound: "email_not_found",
} as const;
export type SignInErrorCode =
  (typeof SignInErrorCode)[keyof typeof SignInErrorCode];

/** Query/body key for the signed invitation link token (A25). */
export const INVITATION_TOKEN_PARAM = "token";
