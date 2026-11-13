import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasPendingInvitation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/identity-provisioning", () => ({
  hasPendingInvitation: mocks.hasPendingInvitation,
}));

import { beforeUserCreate } from "@/lib/auth/user-create-guard";

const OAUTH_CTX = { path: "/callback/:id", params: { id: "microsoft" } };

describe("beforeUserCreate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.hasPendingInvitation.mockReset();
  });

  it("refuses an unverified SSO user", async () => {
    await expect(
      beforeUserCreate(
        { email: "a@example.test", emailVerified: false },
        OAUTH_CTX
      )
    ).rejects.toMatchObject({
      message: expect.stringContaining("no verified email"),
    });
  });

  it("allows a verified SSO user", async () => {
    await expect(
      beforeUserCreate(
        { email: "a@example.test", emailVerified: true },
        OAUTH_CTX
      )
    ).resolves.toBeUndefined();
  });

  it("refuses an unverified social sign-in outside the callback", async () => {
    await expect(
      beforeUserCreate(
        { email: "a@example.test", emailVerified: false },
        { path: "/sign-in/social" }
      )
    ).rejects.toMatchObject({
      message: "A verified email address is required to create an account",
    });
  });

  it("refuses an unverified user without a context and allows a verified one", async () => {
    await expect(
      beforeUserCreate({ email: "a@example.test", emailVerified: false })
    ).rejects.toMatchObject({ message: expect.stringContaining("verified") });
    await expect(
      beforeUserCreate({ email: "a@example.test", emailVerified: true })
    ).resolves.toBeUndefined();
  });

  it("allows the email/password path unverified", async () => {
    await expect(
      beforeUserCreate(
        { email: "a@example.test", emailVerified: false },
        { path: "/sign-up/email" }
      )
    ).resolves.toBeUndefined();
  });

  it("keeps the invite-only refusal for a verified SSO user", async () => {
    vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");
    mocks.hasPendingInvitation.mockResolvedValue(false);
    await expect(
      beforeUserCreate(
        { email: "a@example.test", emailVerified: true },
        OAUTH_CTX
      )
    ).rejects.toMatchObject({ message: "Sign-up is by invitation only" });
  });
});
