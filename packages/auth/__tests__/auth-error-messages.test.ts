import { SignInErrorCode } from "@repo/api/src/types/auth-account";
import { describe, expect, it } from "vitest";
import { withCurrentQuery } from "../components/auth-card";
import {
  readCallbackError,
  signInErrorMessage,
} from "../components/auth-error-messages";

describe("signInErrorMessage", () => {
  it("maps known codes", () => {
    expect(signInErrorMessage(SignInErrorCode.AccountNotLinked)).toContain(
      "already exists"
    );
    expect(signInErrorMessage(SignInErrorCode.SignupDisabled)).toContain(
      "invitation only"
    );
    expect(signInErrorMessage(SignInErrorCode.EmailNotVerified)).toContain(
      "verified email"
    );
  });

  it("falls back to a generic message", () => {
    expect(signInErrorMessage("something_else")).toBe(
      "Could not sign in. Try again."
    );
    expect(signInErrorMessage(null)).toBe("Could not sign in. Try again.");
  });
});

describe("readCallbackError", () => {
  it("reads the error param", () => {
    expect(readCallbackError("?error=account_not_linked&x=1")).toBe(
      "account_not_linked"
    );
    expect(readCallbackError("")).toBeNull();
  });
});

describe("withCurrentQuery", () => {
  it("copies redirect_url and email only", () => {
    expect(
      withCurrentQuery(
        "/sign-up",
        "?redirect_url=%2Finvitations%2F1&email=a%40b.c&error=x"
      )
    ).toBe("/sign-up?redirect_url=%2Finvitations%2F1&email=a%40b.c");
  });

  it("returns the bare path without params", () => {
    expect(withCurrentQuery("/sign-up", "?error=x")).toBe("/sign-up");
    expect(withCurrentQuery("/sign-up", "")).toBe("/sign-up");
  });
});
