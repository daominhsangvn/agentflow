import { describe, expect, it } from "vitest";
import { readPersonalAgentProjectKey } from "../project-runners";

describe("readPersonalAgentProjectKey", () => {
  it("returns the project key of a personal Agent", () => {
    expect(
      readPersonalAgentProjectKey({
        personalRunner: { projectKey: "PRO-1", parallel: false },
      })
    ).toBe("PRO-1");
  });

  it.each([
    {},
    null,
    { personalRunner: {} },
    { personalRunner: { projectKey: "" } },
  ])("returns null for %j", (capabilities) => {
    expect(readPersonalAgentProjectKey(capabilities)).toBeNull();
  });
});
