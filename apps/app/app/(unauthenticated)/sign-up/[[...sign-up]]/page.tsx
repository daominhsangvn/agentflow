import { isSignUpAllowed } from "@repo/auth/sign-up-policy";
import { createMetadata } from "@repo/seo/metadata";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { createAuthPageMetadataGenerator } from "@/lib/og-metadata";

const SignUp = dynamic(() =>
  import("@repo/auth/components/sign-up").then((mod) => mod.SignUp)
);

const DEFAULT_METADATA = createMetadata({
  title: "Create an account",
  description: "Enter your details to get started.",
});

// Unauthenticated visits to protected pages redirect here by default
// (FEA-632), so link-unfurler bots land on this page with a `redirect_url`
// back to the original document. Resolve that document's OG metadata so link
// previews show its real title instead of the generic sign-up metadata.
export const generateMetadata =
  createAuthPageMetadataGenerator(DEFAULT_METADATA);

type SignUpPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Invite-only deployments (`AUTH_ALLOW_SIGN_UP=false`) hide this page: only an
// invitation link (`?email=`) still renders the form, everything else goes to
// sign-in with the same query string.
const SignUpPage = async ({ searchParams }: SignUpPageProps) => {
  const params = await searchParams;
  if (isSignUpAllowed() || params.email) {
    return <SignUp />;
  }
  redirect(signInPath(params));
};

export default SignUpPage;

function signInPath(
  params: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of [value].flat()) {
      if (item !== undefined) {
        query.append(key, item);
      }
    }
  }
  const search = query.toString();
  return search ? `/sign-in?${search}` : "/sign-in";
}
