import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";
import { describe, expect, it } from "vitest";
import { matchTaskRunner } from "../task-runner-match";

function file(
  id: string,
  name: string,
  role: string | null
): ComputeTargetCapabilities {
  return {
    computeTargetId: id,
    runnerName: name,
    capabilities: role === null ? null : { runner: role },
  } as unknown as ComputeTargetCapabilities;
}

describe("matchTaskRunner", () => {
  it("lets the id win over a role equal to another Agent's name", () => {
    const files = [file("a1", "An-PC", "a2"), file("a2", "Binh-PC", null)];
    const result = matchTaskRunner(files, "a2");
    expect(result.ok && result.value.computeTargetId).toBe("a2");
  });

  it("finds a unique name", () => {
    const result = matchTaskRunner(
      [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")],
      "binh-pc"
    );
    expect(result.ok && result.value.computeTargetId).toBe("a2");
  });

  it("finds a unique role case-insensitively", () => {
    const result = matchTaskRunner(
      [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "QC")],
      "qc"
    );
    expect(result.ok && result.value.computeTargetId).toBe("a2");
  });

  it("refuses a role shared by several Agents", () => {
    const result = matchTaskRunner(
      [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")],
      "Dev"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("by role");
      expect(result.error).toContain("An-PC (a1)");
      expect(result.error).toContain("Binh-PC (a2)");
    }
  });

  it("refuses a name shared by several Agents", () => {
    const result = matchTaskRunner(
      [file("a1", "PC", null), file("a2", "pc", null)],
      "PC"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("by name");
    }
  });

  it("lets a name win over another Agent's equal role", () => {
    const result = matchTaskRunner(
      [file("a1", "X", "Dev"), file("a2", "Dev", null)],
      "Dev"
    );
    expect(result.ok && result.value.computeTargetId).toBe("a2");
  });

  it("refuses an unknown Agent", () => {
    const result = matchTaskRunner([file("a1", "An-PC", "Dev")], "x");
    expect(!result.ok && result.error).toContain('No Agent "x"');
  });
});
