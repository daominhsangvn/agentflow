import { isSignUpAllowed } from "@repo/auth/sign-up-policy";
import { createMetadata } from "@repo/seo/metadata";
import dynamic from "next/dynamic";
import { createAuthPageMetadataGenerator } from "@/lib/og-metadata";

const SignIn = dynamic(() =>
  import("@repo/auth/components/sign-in").then((mod) => mod.SignIn)
);

const DEFAULT_METADATA = createMetadata({
  title: "Welcome back",
  description: "Enter your details to sign in.",
});

// When Clerk's auth redirect sets a `redirect_url` query parameter, resolve
// OG metadata for the original page so link-unfurler bots see the document's
// title/description instead of the generic sign-in metadata.
export const generateMetadata =
  createAuthPageMetadataGenerator(DEFAULT_METADATA);

type SignInPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// An invited person (`?email=`) can reach sign-up even on invite-only installs.
const SignInPage = async ({ searchParams }: SignInPageProps) => {
  const params = await searchParams;
  return <SignIn allowSignUp={isSignUpAllowed() || Boolean(params.email)} />;
};

export default SignInPage;
