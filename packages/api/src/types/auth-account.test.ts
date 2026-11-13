import { describe, expect, it } from "vitest";
import {
  INVITATION_TOKEN_PARAM,
  InvitationStatus,
  invitationDetailsSchema,
  isSsoProviderId,
  SsoProviderId,
  signInMethodsSchema,
  signInProvidersSchema,
} from "./auth-account";

describe("auth account contracts", () => {
  it("parses sign-in providers and rejects an unknown id", () => {
    expect(
      signInProvidersSchema.safeParse([
        { id: SsoProviderId.Microsoft, label: "Microsoft" },
      ]).success
    ).toBe(true);
    expect(
      signInProvidersSchema.safeParse([{ id: "okta", label: "Okta" }]).success
    ).toBe(false);
  });

  it("parses sign-in methods", () => {
    expect(
      signInMethodsSchema.safeParse({
        hasPassword: true,
        emailVerified: false,
        providers: [
          { id: SsoProviderId.Microsoft, label: "Microsoft", linked: false },
        ],
      }).success
    ).toBe(true);
  });

  it("parses invitation details", () => {
    expect(
      invitationDetailsSchema.safeParse({
        id: "i1",
        email: "a@b.test",
        role: "member",
        organizationId: "o1",
        organizationName: "Acme",
        organizationSlug: "acme",
        inviterEmail: "o@b.test",
        status: InvitationStatus.Pending,
        expiresAt: "2026-12-01T00:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("parses invitation details with a revived Date expiresAt", () => {
    const result = invitationDetailsSchema.safeParse({
      id: "i1",
      email: "a@b.test",
      role: "member",
      organizationId: "o1",
      organizationName: "Acme",
      organizationSlug: "acme",
      inviterEmail: "o@b.test",
      status: InvitationStatus.Pending,
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(result.success).toBe(true);
    expect(result.data?.expiresAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("guards provider ids", () => {
    expect(isSsoProviderId("microsoft")).toBe(true);
    expect(isSsoProviderId("okta")).toBe(false);
  });
});

describe("invitation token param", () => {
  it("is the token key", () => {
    expect(INVITATION_TOKEN_PARAM).toBe("token");
  });
});
