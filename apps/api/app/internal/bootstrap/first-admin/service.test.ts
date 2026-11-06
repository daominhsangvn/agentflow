import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FirstAdminBootstrapStatus,
  firstAdminBootstrapService,
} from "./service";

const { count, createFirstAdminAccount } = vi.hoisted(() => ({
  count: vi.fn(),
  createFirstAdminAccount: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = { authUser: { count } };
  return { withDb: (fn: (d: typeof db) => unknown) => fn(db) };
});
vi.mock("@/lib/auth/better-auth", () => ({ createFirstAdminAccount }));
vi.mock("@repo/observability/log", () => ({ log: { error: vi.fn() } }));

const input = { email: "a@b.co", password: "password123", name: "Admin" };

describe("firstAdminBootstrapService.ensureFirstAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the account when no user exists", async () => {
    count.mockResolvedValue(0);
    createFirstAdminAccount.mockResolvedValue({ userId: "u1" });
    const result = await firstAdminBootstrapService.ensureFirstAdmin(input);
    expect(result).toEqual({
      ok: true,
      value: { status: FirstAdminBootstrapStatus.Created, userId: "u1" },
    });
    expect(createFirstAdminAccount).toHaveBeenCalledTimes(1);
    expect(createFirstAdminAccount).toHaveBeenCalledWith(input);
  });

  it("skips when a user already exists", async () => {
    count.mockResolvedValue(1);
    const result = await firstAdminBootstrapService.ensureFirstAdmin(input);
    expect(result).toEqual({
      ok: true,
      value: { status: FirstAdminBootstrapStatus.Skipped, userId: null },
    });
    expect(createFirstAdminAccount).not.toHaveBeenCalled();
  });

  it("returns an error when sign-up throws", async () => {
    count.mockResolvedValue(0);
    createFirstAdminAccount.mockRejectedValue(new Error("boom"));
    const result = await firstAdminBootstrapService.ensureFirstAdmin(input);
    expect(result).toEqual({ ok: false, error: Status.Error });
  });
});
