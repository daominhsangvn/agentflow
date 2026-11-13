import { describe, expect, it, vi } from "vitest";

import {
  listSignInProviders,
  setCredentialPassword,
  toSignInMethods,
} from "@/lib/auth/agentflow-auth-plugin";

describe("toSignInMethods", () => {
  it("reports a password-only account", () => {
    expect(
      toSignInMethods({
        accounts: [{ providerId: "credential" }],
        emailVerified: true,
        configuredProviders: ["microsoft"],
      })
    ).toEqual({
      hasPassword: true,
      emailVerified: true,
      providers: [{ id: "microsoft", label: "Microsoft", linked: false }],
    });
  });

  it("reports an SSO-only account", () => {
    const result = toSignInMethods({
      accounts: [{ providerId: "microsoft" }],
      emailVerified: true,
      configuredProviders: ["microsoft"],
    });
    expect(result.hasPassword).toBe(false);
    expect(result.providers[0].linked).toBe(true);
  });

  it("reports both methods and an unverified email", () => {
    const result = toSignInMethods({
      accounts: [{ providerId: "credential" }, { providerId: "microsoft" }],
      emailVerified: false,
      configuredProviders: ["microsoft"],
    });
    expect(result.hasPassword).toBe(true);
    expect(result.emailVerified).toBe(false);
    expect(result.providers[0].linked).toBe(true);
  });

  it("lists no providers when none is configured", () => {
    expect(listSignInProviders([])).toEqual([]);
    expect(
      toSignInMethods({
        accounts: [],
        emailVerified: false,
        configuredProviders: [],
      }).providers
    ).toEqual([]);
  });
});

describe("setCredentialPassword", () => {
  const hash = (password: string) => Promise.resolve(`hashed:${password}`);

  it("refuses when a credential account exists", async () => {
    const adapter = {
      findAccounts: vi.fn().mockResolvedValue([{ providerId: "credential" }]),
      linkAccount: vi.fn(),
    };
    await expect(
      setCredentialPassword(adapter, "user-1", "password-1", hash)
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(adapter.linkAccount).not.toHaveBeenCalled();
  });

  it("links a hashed credential account for an SSO-only user", async () => {
    const adapter = {
      findAccounts: vi.fn().mockResolvedValue([{ providerId: "microsoft" }]),
      linkAccount: vi.fn().mockResolvedValue({}),
    };
    await setCredentialPassword(adapter, "user-1", "password-1", hash);
    expect(adapter.linkAccount).toHaveBeenCalledWith({
      userId: "user-1",
      providerId: "credential",
      accountId: "user-1",
      password: "hashed:password-1",
    });
  });
});
