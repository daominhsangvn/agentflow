import { describe, expect, it } from "vitest";
import { createRunSlots } from "../run-slots";

describe("createRunSlots", () => {
  it("refuses an acquire beyond the cap", () => {
    const slots = createRunSlots(2);
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
    expect(slots.active()).toBe(2);
  });

  it("frees a slot on release", () => {
    const slots = createRunSlots(1);
    const release = slots.tryAcquire();
    expect(slots.tryAcquire()).toBeNull();
    release?.();
    expect(slots.active()).toBe(0);
    expect(slots.tryAcquire()).not.toBeNull();
  });

  it("ignores a double release", () => {
    const slots = createRunSlots(2);
    const first = slots.tryAcquire();
    slots.tryAcquire();
    first?.();
    first?.();
    expect(slots.active()).toBe(1);
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();
  });
});
