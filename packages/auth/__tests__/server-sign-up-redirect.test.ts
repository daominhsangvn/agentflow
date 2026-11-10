import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthObject } from "../server";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => url,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("redirectToSignUp", () => {
  it("goes to sign-up by default", () => {
    const auth = buildAuthObject(null, null);

    expect(auth.redirectToSignUp({ returnBackUrl: "/acme" })).toBe(
      "/sign-up?redirect_url=%2Facme"
    );
  });

  it("goes to sign-in when sign-up is disabled", () => {
    vi.stubEnv("AUTH_ALLOW_SIGN_UP", "false");
    const auth = buildAuthObject(null, null);

    expect(auth.redirectToSignUp({ returnBackUrl: "/acme" })).toBe(
      "/sign-in?redirect_url=%2Facme"
    );
  });
});
