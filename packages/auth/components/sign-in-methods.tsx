"use client";

import type { SignInMethods as SignInMethodsData } from "@repo/api/src/types/auth-account";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { authApi, useSessionSnapshot } from "../auth-client";
import { errorMessage } from "./auth-card";
import { readCallbackError, signInErrorMessage } from "./auth-error-messages";

const MIN_PASSWORD_LENGTH = 8;

type SignInMethodsProps = {
  readonly onError: (message: string | null) => void;
  readonly onNotice: (message: string | null) => void;
};

/** Profile section: email verification, password and connected sign-in providers. */
export function SignInMethods({ onError, onNotice }: SignInMethodsProps) {
  const session = useSessionSnapshot();
  const [methods, setMethods] = useState<SignInMethodsData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await authApi.getSignInMethods();
    if (result.data) {
      setMethods(result.data);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const code = readCallbackError(globalThis.location?.search);
    if (code) {
      onError(signInErrorMessage(code));
    }
  }, [load, onError]);

  if (!methods) {
    return null;
  }

  const email = session.claims?.email ?? "";

  const sendVerification = async () => {
    setBusy(true);
    onError(null);
    const result = await authApi.sendVerificationEmail({
      email,
      callbackURL: globalThis.location.href,
    });
    setBusy(false);
    if (result.error) {
      onError(
        errorMessage(result.error, "Could not send the verification link")
      );
      return;
    }
    onNotice("Verification link sent. Check your inbox.");
  };

  const connect = async (provider: SignInMethodsData["providers"][number]) => {
    setBusy(true);
    onError(null);
    const result = await authApi.linkSocial({
      provider: provider.id,
      callbackURL: globalThis.location.href,
      errorCallbackURL: globalThis.location.href,
    });
    if (result.error) {
      setBusy(false);
      onError(
        errorMessage(result.error, `Could not connect ${provider.label}`)
      );
    }
  };

  const disconnect = async (
    provider: SignInMethodsData["providers"][number]
  ) => {
    setBusy(true);
    onError(null);
    const result = await authApi.unlinkAccount({ providerId: provider.id });
    setBusy(false);
    if (result.error) {
      onError(
        errorMessage(result.error, `Could not disconnect ${provider.label}`)
      );
      return;
    }
    await load();
  };

  return (
    <div className="space-y-6">
      {methods.emailVerified ? null : (
        <div className="space-y-2">
          <h3 className="font-medium">Email not verified</h3>
          <p className="text-muted-foreground text-sm">
            Signing in with SSO by email needs a verified address.
          </p>
          <Button
            disabled={busy}
            onClick={sendVerification}
            type="button"
            variant="outline"
          >
            Send verification link
          </Button>
        </div>
      )}

      {methods.hasPassword ? (
        <ChangePasswordForm onError={onError} onNotice={onNotice} />
      ) : (
        <SetPasswordForm onError={onError} />
      )}

      {methods.providers.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-medium">Connected accounts</h3>
          {methods.providers.map((provider) => (
            <div
              className="flex items-center justify-between"
              key={provider.id}
            >
              <span className="text-sm">
                {provider.label}
                {provider.linked ? " · Connected" : ""}
              </span>
              {provider.linked ? (
                <Button
                  disabled={busy || !canDisconnect(methods)}
                  onClick={() => disconnect(provider)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() => connect(provider)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Connect {provider.label}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A provider can be disconnected unless it is the only way to sign in. */
export function canDisconnect(
  methods: Pick<SignInMethodsData, "hasPassword" | "providers">
): boolean {
  const linkedCount = methods.providers.filter((p) => p.linked).length;
  return !(!methods.hasPassword && linkedCount === 1);
}

function ChangePasswordForm({
  onError,
  onNotice,
}: Readonly<SignInMethodsProps>) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      onError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for the password`
      );
      return;
    }
    setBusy(true);
    onError(null);
    onNotice(null);
    const result = await authApi.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (result.error) {
      onError(errorMessage(result.error, "Could not change your password"));
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    onNotice("Password changed. Other sessions were signed out.");
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <h3 className="font-medium">Change password</h3>
      <div className="space-y-2">
        <Label htmlFor="profile-current-password">Current password</Label>
        <Input
          autoComplete="current-password"
          id="profile-current-password"
          onChange={(event) => setCurrentPassword(event.target.value)}
          type="password"
          value={currentPassword}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-new-password">New password</Label>
        <Input
          autoComplete="new-password"
          id="profile-new-password"
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
        />
      </div>
      <Button disabled={busy || !currentPassword || !newPassword} type="submit">
        Change password
      </Button>
    </form>
  );
}

function SetPasswordForm({
  onError,
}: Readonly<Pick<SignInMethodsProps, "onError">>) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      onError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for the password`
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      onError("The passwords do not match");
      return;
    }
    setBusy(true);
    onError(null);
    const result = await authApi.setPassword(newPassword);
    if (result.error) {
      setBusy(false);
      onError(errorMessage(result.error, "Could not set the password"));
      return;
    }
    globalThis.location.reload();
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
      <h3 className="font-medium">Set a password</h3>
      <div className="space-y-2">
        <Label htmlFor="profile-set-password">New password</Label>
        <Input
          autoComplete="new-password"
          id="profile-set-password"
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="profile-confirm-password">Confirm password</Label>
        <Input
          autoComplete="new-password"
          id="profile-confirm-password"
          onChange={(event) => setConfirmPassword(event.target.value)}
          type="password"
          value={confirmPassword}
        />
      </div>
      <Button disabled={busy || !newPassword || !confirmPassword} type="submit">
        Set password
      </Button>
    </form>
  );
}
