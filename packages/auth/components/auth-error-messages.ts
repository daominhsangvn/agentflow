import { SignInErrorCode } from "@repo/api/src/types/auth-account";

const GENERIC_SIGN_IN_ERROR = "Could not sign in. Try again.";

const SIGN_IN_ERROR_MESSAGES: Record<string, string> = {
  [SignInErrorCode.AccountNotLinked]:
    "An account with this email already exists. Sign in with your password and verify your email, or connect Microsoft in Profile.",
  [SignInErrorCode.EmailNotVerified]:
    "Your Microsoft account has no verified email address. Ask your administrator or use email and password.",
  [SignInErrorCode.EmailNotFound]:
    "Your Microsoft account has no email address. Ask your administrator or use email and password.",
  [SignInErrorCode.SignupDisabled]: "Sign-up is by invitation only.",
  [SignInErrorCode.UnableToCreateUser]: "Sign-up is by invitation only.",
  [SignInErrorCode.UnableToLinkAccount]:
    "Could not connect this account. Try again, or contact your administrator.",
  [SignInErrorCode.EmailDoesNotMatch]:
    "That account uses a different email address than yours, so it cannot be connected.",
  account_already_linked_to_different_user:
    "That account is already connected to another user.",
};

/** User-facing text for a sign-in or link callback `?error=` code. */
export function signInErrorMessage(code: string | null | undefined): string {
  if (!code) {
    return GENERIC_SIGN_IN_ERROR;
  }
  return SIGN_IN_ERROR_MESSAGES[code] ?? GENERIC_SIGN_IN_ERROR;
}

/** The `?error=` value from a query string, or null. */
export function readCallbackError(search: string | undefined): string | null {
  return new URLSearchParams(search ?? "").get("error");
}
