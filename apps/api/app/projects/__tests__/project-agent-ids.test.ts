import { describe, expect, it } from "vitest";
import { projectAgentIds } from "../project-agent-ids";

describe("projectAgentIds", () => {
  it("is empty without a project", () => {
    expect(projectAgentIds(null)).toEqual([]);
    expect(projectAgentIds(undefined)).toEqual([]);
  });

  it("keeps the order of the rows", () => {
    expect(
      projectAgentIds({
        agents: [{ computeTargetId: "b" }, { computeTargetId: "a" }],
      })
    ).toEqual(["b", "a"]);
  });
});
