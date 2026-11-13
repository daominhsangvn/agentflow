"use client";

import { useEffect, useState } from "react";
import { authApi, refreshSession } from "../auth-client";
import {
  AuthCard,
  AuthField,
  errorMessage,
  readRedirectTarget,
  SsoButtons,
  withCurrentQuery,
} from "./auth-card";
import { readCallbackError, signInErrorMessage } from "./auth-error-messages";

type SignInProps = {
  /** Show the "Create one" link; false on invite-only deployments. */
  readonly allowSignUp?: boolean;
};

/** Email/password sign-in, with an inline "forgot password" request. */
export const SignIn = ({ allowSignUp = true }: SignInProps) => {
  const [mode, setMode] = useState<"sign-in" | "forgot">("sign-in");
  const [email, setEmail] = useState(
    () =>
      new URLSearchParams(globalThis.location?.search ?? "").get("email") ?? ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const code = readCallbackError(globalThis.location?.search);
    if (code) {
      setError(signInErrorMessage(code));
    }
  }, []);

  const signIn = async () => {
    setSubmitting(true);
    setError(null);
    const result = await authApi.signInEmail({ email, password });
    if (result.error) {
      setError(errorMessage(result.error, "Could not sign in"));
      setSubmitting(false);
      return;
    }
    await refreshSession();
    globalThis.location.assign(readRedirectTarget());
  };

  const requestReset = async () => {
    setSubmitting(true);
    setError(null);
    const result = await authApi.requestPasswordReset({
      email,
      redirectTo: `${globalThis.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (result.error) {
      setError(errorMessage(result.error, "Could not send the reset email"));
      return;
    }
    setNotice(
      "If an account exists for that email, a reset link is on its way."
    );
  };

  if (mode === "forgot") {
    return (
      <AuthCard
        description={
          notice ?? "We will email you a link to set a new password."
        }
        error={error}
        footer={
          <button
            className="underline"
            onClick={() => setMode("sign-in")}
            type="button"
          >
            Back to sign in
          </button>
        }
        onSubmit={requestReset}
        submitLabel="Send reset link"
        submitting={submitting}
        title="Reset your password"
      >
        <AuthField
          autoComplete="email"
          id="email"
          label="Email"
          onChange={setEmail}
          type="email"
          value={email}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      error={error}
      footer={
        allowSignUp ? (
          <span>
            No account?{" "}
            <a className="underline" href={withCurrentQuery("/sign-up")}>
              Create one
            </a>
          </span>
        ) : undefined
      }
      onSubmit={signIn}
      submitLabel="Sign in"
      submitting={submitting}
      title="Welcome to AgentFlow"
    >
      <AuthField
        autoComplete="email"
        id="email"
        label="Email"
        onChange={setEmail}
        type="email"
        value={email}
      />
      <AuthField
        autoComplete="current-password"
        id="password"
        label="Password"
        onChange={setPassword}
        type="password"
        value={password}
      />
      <button
        className="text-muted-foreground text-sm underline"
        onClick={() => setMode("forgot")}
        type="button"
      >
        Forgot password?
      </button>
      <SsoButtons onError={setError} />
    </AuthCard>
  );
};
