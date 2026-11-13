import type { Browser, Page } from "@playwright/test";
import {
  createInvitation,
  getSessionBearerToken,
  listOrganizations,
  OrgRole,
  requireOrgClaims,
  signUpUser,
  waitForSignedInSession,
} from "./helpers/better-auth";
import { waitForInvitationLink } from "./helpers/mailpit";
import { ensureWizardCompleted } from "./helpers/onboarding";
import { expect, test } from "./test";

const FIRST_ORG_SLUG = "agentflow";
const INVITATION_URL = /\/invitations\//;
const SIGN_IN_URL = /\/sign-in/;
const RE_ANOTHER_EMAIL = /invitation is for another email address/i;
const TOKEN_PARAM = /token=/;
const RE_INVALID = /This invitation is no longer valid\./;
const RE_DECLINED = /Invitation declined/i;

// Fresh accounts only: nothing here uses the shared e2e user or its storage state.
test.use({ storageState: { cookies: [], origins: [] } });

type Account = {
  email: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  page: Page;
  password: string;
};

test.describe("own organization and invitations", () => {
  test("a fresh sign-up owns a new organization", async ({ browser }) => {
    const user = await createAccount(browser, "owned");

    const claims = await sessionClaims(user.page);

    expect(claims.orgSlug).not.toBe(FIRST_ORG_SLUG);
    expect(claims.orgRole).toBe(OrgRole.Owner);
  });

  test("an existing user accepts an invitation and switches organizations", async ({
    browser,
  }) => {
    const owner = await createAccount(browser, "owner");
    const invitee = await createAccount(browser, "invitee");
    await createInvitation(owner.page.request, {
      email: invitee.email,
      organizationId: owner.orgId,
    });
    const link = await waitForInvitationLink(owner.page.request, invitee.email);
    await invitee.page.context().clearCookies();

    await invitee.page.goto(link);
    await expect(invitee.page).toHaveURL(SIGN_IN_URL);
    await invitee.page.getByLabel("Email", { exact: true }).fill(invitee.email);
    await invitee.page
      .getByLabel("Password", { exact: true })
      .fill(invitee.password);
    await invitee.page
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await expect(invitee.page).toHaveURL(INVITATION_URL);
    await expect(invitee.page).toHaveURL(TOKEN_PARAM);
    await invitee.page.getByRole("button", { name: "Accept" }).click();

    await expect(invitee.page).toHaveURL(
      new RegExp(`/${owner.orgSlug}/dashboard`)
    );
    await waitForSignedInSession(invitee.page);
    const names = (await listOrganizations(invitee.page.request)).map(
      (org) => org.name
    );
    expect(names).toEqual(
      expect.arrayContaining([owner.orgName, invitee.orgName])
    );

    await invitee.page
      .getByRole("button", { name: "Open organization switcher" })
      .click();
    await invitee.page.getByRole("menuitem", { name: invitee.orgName }).click();
    await expect(invitee.page).toHaveURL(
      new RegExp(`/${invitee.orgSlug}/dashboard`)
    );
  });

  test("declining leaves membership unchanged", async ({ browser }) => {
    const owner = await createAccount(browser, "decline-owner");
    const invitee = await createAccount(browser, "decliner");
    await createInvitation(owner.page.request, {
      email: invitee.email,
      organizationId: owner.orgId,
    });
    const link = await waitForInvitationLink(owner.page.request, invitee.email);

    await invitee.page.goto(link);
    await invitee.page.getByRole("button", { name: "Decline" }).click();

    await expect(invitee.page.getByText(RE_DECLINED)).toBeVisible();
    const orgs = await listOrganizations(invitee.page.request);
    expect(orgs.map((org) => org.id)).toEqual([invitee.orgId]);
  });

  test("the wrong account sees the mismatch message", async ({ browser }) => {
    const owner = await createAccount(browser, "mismatch-owner");
    const invited = await createAccount(browser, "invited");
    const other = await createAccount(browser, "other");
    await createInvitation(owner.page.request, {
      email: invited.email,
      organizationId: owner.orgId,
    });
    const link = await waitForInvitationLink(owner.page.request, invited.email);

    await other.page.goto(link);

    await expect(other.page.getByText(RE_ANOTHER_EMAIL)).toBeVisible();
  });

  test("an invitation link without its token is not valid", async ({
    browser,
  }) => {
    const owner = await createAccount(browser, "token-owner");
    const invitee = await createAccount(browser, "token-invitee");
    await createInvitation(owner.page.request, {
      email: invitee.email,
      organizationId: owner.orgId,
    });
    const link = await waitForInvitationLink(owner.page.request, invitee.email);
    expect(link).toMatch(TOKEN_PARAM);
    const url = new URL(link);
    url.searchParams.delete("token");

    await invitee.page.goto(url.toString());
    await expect(invitee.page.getByText(RE_INVALID)).toBeVisible();

    await invitee.page.goto(link);
    await expect(
      invitee.page.getByRole("button", { name: "Accept" })
    ).toBeVisible();
  });
});

/** Signs up a new user in its own browser context; returns its org and page. */
async function createAccount(
  browser: Browser,
  label: string
): Promise<Account> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const credentials = await signUpUser(page.request, email);
  await waitForSignedInSession(page);
  const claims = await sessionClaims(page);
  const org = (await listOrganizations(page.request)).find(
    (candidate) => candidate.id === claims.orgId
  );
  if (!org) {
    throw new Error(`No organization ${claims.orgId} for ${email}`);
  }
  // A brand-new org redirects every route to /onboarding until the wizard is done.
  await ensureWizardCompleted(page.request, await getSessionBearerToken(page));
  return {
    email,
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    page,
    password: credentials.password,
  };
}

async function sessionClaims(page: Page) {
  return requireOrgClaims(await getSessionBearerToken(page));
}
