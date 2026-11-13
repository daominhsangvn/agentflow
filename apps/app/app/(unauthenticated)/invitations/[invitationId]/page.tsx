import { INVITATION_TOKEN_PARAM } from "@repo/api/src/types/auth-account";
import { auth } from "@repo/auth/server";
import { createMetadata } from "@repo/seo/metadata";
import { redirect } from "next/navigation";
import { invitationPath } from "./invitation-path";
import { InvitationReview } from "./invitation-review";

export const metadata = createMetadata({
  title: "Invitation",
  description: "Review your organization invitation.",
});

type InvitationPageProps = {
  readonly params: Promise<{ invitationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Behind sign-in on purpose: Better Auth only returns an invitation to the
// session whose email it was sent to.
const InvitationPage = async ({
  params,
  searchParams,
}: InvitationPageProps) => {
  const { invitationId } = await params;
  const query = await searchParams;
  const rawToken = query[INVITATION_TOKEN_PARAM];
  const token = (Array.isArray(rawToken) ? rawToken[0] : rawToken) ?? null;
  const { userId } = await auth();
  if (!userId) {
    redirect(buildSignInUrl(invitationId, token, query.email));
  }
  return <InvitationReview invitationId={invitationId} token={token} />;
};

function buildSignInUrl(
  invitationId: string,
  token: string | null,
  email: string | string[] | undefined
): string {
  const returnUrl = invitationPath(invitationId, token);
  const search = new URLSearchParams({ redirect_url: returnUrl });
  const invitedEmail = Array.isArray(email) ? email[0] : email;
  if (invitedEmail) {
    search.set("email", invitedEmail);
  }
  return `/sign-in?${search.toString()}`;
}

export default InvitationPage;
