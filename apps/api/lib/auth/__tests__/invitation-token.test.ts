import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invitationToken,
  isValidInvitationToken,
} from "@/lib/auth/invitation-token";

const SECRET = "test-secret-one";

describe("invitation token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is deterministic per id and secret", () => {
    expect(invitationToken("inv-1", SECRET)).toBe(
      invitationToken("inv-1", SECRET)
    );
  });

  it("differs per id and per secret", () => {
    const token = invitationToken("inv-1", SECRET);
    expect(invitationToken("inv-2", SECRET)).not.toBe(token);
    expect(invitationToken("inv-1", "other-secret")).not.toBe(token);
  });

  it("accepts the right token", () => {
    expect(
      isValidInvitationToken("inv-1", invitationToken("inv-1", SECRET), SECRET)
    ).toBe(true);
  });

  it("rejects missing, truncated, altered and foreign tokens", () => {
    const token = invitationToken("inv-1", SECRET);
    const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(isValidInvitationToken("inv-1", undefined, SECRET)).toBe(false);
    expect(isValidInvitationToken("inv-1", "", SECRET)).toBe(false);
    expect(isValidInvitationToken("inv-1", token.slice(0, -1), SECRET)).toBe(
      false
    );
    expect(isValidInvitationToken("inv-1", flipped, SECRET)).toBe(false);
    expect(isValidInvitationToken("inv-2", token, SECRET)).toBe(false);
  });

  it("reads the secret from the environment and throws without it", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => invitationToken("inv-1")).toThrow(
      "BETTER_AUTH_SECRET is required"
    );
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    expect(isValidInvitationToken("inv-1", invitationToken("inv-1"))).toBe(
      true
    );
  });
});
