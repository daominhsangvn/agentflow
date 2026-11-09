import { describe, expect, it } from "vitest";
import { projectAgentOptions } from "../workflow-editor-options";

const options = [
  { id: "a", label: "A", isOnline: true },
  { id: "b", label: "B", isOnline: false },
];

describe("projectAgentOptions", () => {
  it("keeps all options without project Agents", () => {
    expect(projectAgentOptions(options, [])).toEqual(options);
  });

  it("keeps only the listed Agents", () => {
    expect(projectAgentOptions(options, ["b"])).toEqual([options[1]]);
  });
});
