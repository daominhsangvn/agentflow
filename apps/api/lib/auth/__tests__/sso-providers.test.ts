import { describe, expect, it } from "vitest";

import {
  buildSocialProviders,
  configuredSsoProviderIds,
  isMicrosoftEmailVerified,
} from "@/lib/auth/sso-providers";

const TENANT_GUID = "11111111-2222-3333-4444-555555555555";
const EMAIL = "ada@example.test";

describe("buildSocialProviders", () => {
  it("is empty without env", () => {
    expect(buildSocialProviders({})).toEqual({});
    expect(configuredSsoProviderIds({})).toEqual([]);
  });

  it("is empty when the secret is missing", () => {
    const env = { AUTH_MICROSOFT_CLIENT_ID: "id" };
    expect(configuredSsoProviderIds(env)).toEqual([]);
  });

  it("enables Microsoft with id and secret, defaulting the tenant", () => {
    const env = {
      AUTH_MICROSOFT_CLIENT_ID: "id",
      AUTH_MICROSOFT_CLIENT_SECRET: "secret",
    };
    expect(configuredSsoProviderIds(env)).toEqual(["microsoft"]);
    expect(buildSocialProviders(env)).toMatchObject({
      microsoft: {
        clientId: "id",
        tenantId: "common",
        disableIdTokenSignIn: true,
      },
    });
  });
});

describe("isMicrosoftEmailVerified", () => {
  it("accepts an asserted email with xms_edov on a multi-tenant app", () => {
    expect(
      isMicrosoftEmailVerified(
        { email: EMAIL, xms_edov: true, verified_primary_email: [EMAIL] },
        "common"
      )
    ).toBe(true);
  });

  it("rejects an asserted email without xms_edov on a multi-tenant app", () => {
    expect(
      isMicrosoftEmailVerified(
        { email: EMAIL, verified_primary_email: [EMAIL] },
        "common"
      )
    ).toBe(false);
  });

  it("accepts an asserted email in a pinned tenant", () => {
    expect(
      isMicrosoftEmailVerified(
        { email: "ADA@example.test", verified_primary_email: [EMAIL] },
        TENANT_GUID
      )
    ).toBe(true);
  });

  it("rejects a pinned tenant when nothing is asserted", () => {
    expect(isMicrosoftEmailVerified({ email: EMAIL }, TENANT_GUID)).toBe(false);
  });

  it("rejects a missing email", () => {
    expect(
      isMicrosoftEmailVerified(
        { email_verified: true, xms_edov: true },
        TENANT_GUID
      )
    ).toBe(false);
  });
});
