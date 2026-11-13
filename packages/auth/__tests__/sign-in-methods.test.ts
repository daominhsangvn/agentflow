import { SsoProviderId } from "@repo/api/src/types/auth-account";
import { describe, expect, it } from "vitest";
import { canDisconnect } from "../components/sign-in-methods";

const provider = (linked: boolean) => ({
  id: SsoProviderId.Microsoft,
  label: "Microsoft",
  linked,
});

describe("canDisconnect", () => {
  it("blocks the only sign-in method", () => {
    expect(
      canDisconnect({ hasPassword: false, providers: [provider(true)] })
    ).toBe(false);
  });

  it("allows it when a password exists", () => {
    expect(
      canDisconnect({ hasPassword: true, providers: [provider(true)] })
    ).toBe(true);
  });
});
