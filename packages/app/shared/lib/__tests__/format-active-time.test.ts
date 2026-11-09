import { describe, expect, it } from "vitest";
import { formatActiveTime } from "../format-active-time";

describe("formatActiveTime", () => {
  it.each([
    null,
    Number.NaN,
    -1,
    Number.POSITIVE_INFINITY,
  ])("renders - for %s", (value) => {
    expect(formatActiveTime(value)).toBe("-");
  });

  it("formats seconds, minutes, hours and days", () => {
    expect(formatActiveTime(45_000)).toBe("45s");
    expect(formatActiveTime(12 * 60_000)).toBe("12m");
    expect(formatActiveTime(5_400_000)).toBe("1h 30m");
    expect(formatActiveTime(26 * 3_600_000)).toBe("1d 2h");
  });

  it("renders 0s for zero", () => {
    expect(formatActiveTime(0)).toBe("0s");
  });
});
