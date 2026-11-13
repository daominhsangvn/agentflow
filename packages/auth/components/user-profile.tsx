"use client";

import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { type FormEvent, useEffect, useState } from "react";
import { authApi, refreshSession, useSessionSnapshot } from "../auth-client";
import { errorMessage } from "./auth-card";
import { SignInMethods } from "./sign-in-methods";

/** Profile settings: display name and sign-in methods. */
export function UserProfile(_props: Readonly<Record<string, unknown>>) {
  const session = useSessionSnapshot();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(session.claims?.name ?? "");
  }, [session.claims?.name]);

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await authApi.updateUser({ name });
    setBusy(false);
    if (result.error) {
      setError(errorMessage(result.error, "Could not update your name"));
      return;
    }
    await refreshSession();
    setNotice("Name updated.");
  };

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Email</p>
        <p>{session.claims?.email ?? ""}</p>
      </div>

      <form className="flex items-end gap-2" onSubmit={saveName}>
        <div className="flex-1 space-y-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            autoComplete="name"
            id="profile-name"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </div>
        <Button disabled={busy || !name.trim()} type="submit" variant="outline">
          Save
        </Button>
      </form>

      <SignInMethods onError={setError} onNotice={setNotice} />
    </div>
  );
}
