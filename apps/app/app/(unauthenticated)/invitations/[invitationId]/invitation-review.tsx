"use client";

import type { InvitationDetails } from "@repo/api/src/types/auth-account";
import {
  authApi,
  type InvitationResult,
  setActive,
  signOut,
} from "@repo/auth/auth-client";
import { useUser } from "@repo/auth/client";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Link } from "@repo/navigation/link";
import { useEffect, useState } from "react";
import { invitationPath } from "./invitation-path";

const FORBIDDEN_STATUS = 403;
const ORG_ROLE_PREFIX = "org:";

export const InvitationViewState = {
  Loaded: "loaded",
  Mismatch: "mismatch",
  Invalid: "invalid",
} as const;
export type InvitationViewState =
  (typeof InvitationViewState)[keyof typeof InvitationViewState];

type Phase = "review" | "declined";

export function InvitationReview({
  invitationId,
  token,
}: Readonly<{ invitationId: string; token: string | null }>) {
  const { user } = useUser();
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi.getInvitation(invitationId, token).then((next) => {
      if (!cancelled) {
        setResult(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [invitationId, token]);

  if (!result) {
    return <Shell title="Loading invitation…" />;
  }
  if (phase === "declined") {
    return (
      <Shell title="Invitation declined">
        <ContinueLink />
      </Shell>
    );
  }

  const state = invitationViewState(result);
  if (state === InvitationViewState.Mismatch) {
    return (
      <Shell title="This invitation is for another email address.">
        <p className="text-muted-foreground text-sm">
          You are signed in as{" "}
          {user?.primaryEmailAddress?.emailAddress ?? "another account"}.
        </p>
        <Button
          onClick={() =>
            signOut({
              redirectUrl: invitationPath(invitationId, token),
            })
          }
          variant="outline"
        >
          Sign out
        </Button>
      </Shell>
    );
  }
  if (state === InvitationViewState.Invalid || !result.data) {
    return (
      <Shell title="This invitation is no longer valid.">
        <ContinueLink />
      </Shell>
    );
  }

  const invitation = result.data;
  const accept = async () => {
    setBusy(true);
    setError(null);
    const accepted = await authApi.acceptInvitation(invitationId, token);
    if (accepted.error) {
      setError(accepted.error.message ?? "Could not accept the invitation.");
      setBusy(false);
      return;
    }
    await setActive({ organization: invitation.organizationId });
    globalThis.location.assign(`/${invitation.organizationSlug}/dashboard`);
  };
  const decline = async () => {
    setBusy(true);
    setError(null);
    const rejected = await authApi.rejectInvitation(invitationId, token);
    setBusy(false);
    if (rejected.error) {
      setError(rejected.error.message ?? "Could not decline the invitation.");
      return;
    }
    setPhase("declined");
  };

  return (
    <Shell
      description={`${invitation.inviterEmail} invited you to join.`}
      footer={
        <>
          <Button disabled={busy} onClick={accept}>
            Accept
          </Button>
          <Button disabled={busy} onClick={decline} variant="outline">
            Decline
          </Button>
        </>
      }
      title={`Join ${invitation.organizationName}`}
    >
      <InvitationDetailsList invitation={invitation} />
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </Shell>
  );
}

/** Classifies a `getInvitation` result for the page. */
export function invitationViewState(
  result: InvitationResult
): InvitationViewState {
  if (result.data) {
    return InvitationViewState.Loaded;
  }
  if (result.error?.status === FORBIDDEN_STATUS) {
    return InvitationViewState.Mismatch;
  }
  return InvitationViewState.Invalid;
}

/** `org:admin` or `admin` to `Admin`. */
export function roleLabel(role: string): string {
  const bare = role.startsWith(ORG_ROLE_PREFIX)
    ? role.slice(ORG_ROLE_PREFIX.length)
    : role;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function InvitationDetailsList({
  invitation,
}: Readonly<{ invitation: InvitationDetails }>) {
  return (
    <dl className="space-y-1 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Role</dt>
        <dd>{roleLabel(invitation.role)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Expires</dt>
        <dd>{new Date(invitation.expiresAt).toLocaleDateString()}</dd>
      </div>
    </dl>
  );
}

function ContinueLink() {
  return (
    <Link className="text-primary text-sm underline" href="/">
      Continue
    </Link>
  );
}

function Shell({
  title,
  description,
  children,
  footer,
}: Readonly<{
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <Card className="w-full max-w-sm border-0 shadow-none">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? (
        <CardContent className="space-y-4">{children}</CardContent>
      ) : null}
      {footer ? <CardFooter className="gap-2">{footer}</CardFooter> : null}
    </Card>
  );
}
