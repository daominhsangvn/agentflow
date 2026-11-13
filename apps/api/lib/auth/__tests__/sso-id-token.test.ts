import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/identity-provisioning", () => ({
  hasPendingInvitation: vi.fn().mockResolvedValue(false),
}));

import { buildSocialProviders } from "@/lib/auth/sso-providers";
import { beforeUserCreate } from "@/lib/auth/user-create-guard";
import {
  type AuthTestInstance,
  createAuthTestInstance,
} from "../../../__tests__/support/auth/better-auth.test-harness";

describe("Microsoft id-token paths (real Better Auth)", () => {
  let h: AuthTestInstance;

  beforeEach(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-for-sso");
    h = await createAuthTestInstance({
      socialProviders: buildSocialProviders({
        AUTH_MICROSOFT_CLIENT_ID: "id",
        AUTH_MICROSOFT_CLIENT_SECRET: "secret",
      }),
      databaseHooks: { user: { create: { before: beforeUserCreate } } },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses id-token sign-in", async () => {
    const res = await h.post("/sign-in/social", new Headers(), {
      provider: "microsoft",
      idToken: { token: "a.b.c" },
    });
    expect(res.status).toBe(404);
    expect(res.code).toBe("ID_TOKEN_NOT_SUPPORTED");
  });

  it("refuses id-token account linking for a signed-in user", async () => {
    const { headers } = await h.signUp("a@x.test");
    const res = await h.post("/link-social", headers, {
      provider: "microsoft",
      idToken: { token: "a.b.c" },
    });
    expect(res.status).toBe(404);
  });

  it("still allows a password sign-up", async () => {
    const { userId } = await h.signUp("b@x.test");
    expect(userId).toBeTruthy();
  });
});
