import { describe, expect, it } from "vitest";
import {
  isFirstAdminSignUp,
  runAsFirstAdminSignUp,
} from "@/lib/auth/first-admin-sign-up";

describe("first admin sign-up scope", () => {
  it("is false outside the scope", () => {
    expect(isFirstAdminSignUp()).toBe(false);
  });

  it("is true inside the scope, including after awaits", async () => {
    const inside = await runAsFirstAdminSignUp(async () => {
      await Promise.resolve();
      return isFirstAdminSignUp();
    });
    expect(inside).toBe(true);
  });

  it("does not leak to code that runs after the scope or concurrently", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scoped = runAsFirstAdminSignUp(async () => {
      await gate;
      return isFirstAdminSignUp();
    });
    expect(isFirstAdminSignUp()).toBe(false);
    release();
    expect(await scoped).toBe(true);
    expect(isFirstAdminSignUp()).toBe(false);
  });
});
