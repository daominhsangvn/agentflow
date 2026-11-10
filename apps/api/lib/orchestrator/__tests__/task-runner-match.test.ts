import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";
import { describe, expect, it } from "vitest";
import {
  type CaseRunnerContext,
  caseAffinity,
  pickCaseTaskRunner,
  type RunnerLoad,
} from "../task-runner-match";

function file(
  id: string,
  name: string,
  role: string | null,
  online = true
): ComputeTargetCapabilities {
  return {
    computeTargetId: id,
    runnerName: name,
    isOnline: online,
    capabilities: role === null ? null : { runner: role },
  } as unknown as ComputeTargetCapabilities;
}

const empty: CaseRunnerContext = { startedTargetIds: [], loads: new Map() };

function started(...ids: string[]): CaseRunnerContext {
  return { startedTargetIds: ids, loads: new Map() };
}

function picked(
  files: ComputeTargetCapabilities[],
  runner: string,
  context: CaseRunnerContext = empty
): string | undefined {
  const result = pickCaseTaskRunner(files, runner, context);
  return result.ok ? result.value.computeTargetId : undefined;
}

describe("pickCaseTaskRunner", () => {
  it("lets the id win over a role equal to another Agent's name", () => {
    const files = [file("a1", "An-PC", "a2"), file("a2", "Binh-PC", null)];
    expect(picked(files, "a2")).toBe("a2");
  });

  it("finds a unique name", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")];
    expect(picked(files, "binh-pc")).toBe("a2");
  });

  it("finds a unique role case-insensitively", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "QC")];
    expect(picked(files, "qc")).toBe("a2");
  });

  it("lets a name win over another Agent's equal role", () => {
    const files = [file("a1", "X", "Dev"), file("a2", "Dev", null)];
    expect(picked(files, "Dev")).toBe("a2");
  });

  it("refuses an unknown Agent", () => {
    const result = pickCaseTaskRunner([file("a1", "An-PC", "Dev")], "x", empty);
    expect(!result.ok && result.error).toContain('No Agent "x"');
  });

  it("picks the case's Agent for a role shared by several", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")];
    expect(picked(files, "Dev", started("a2"))).toBe("a2");
  });

  it("picks the case's Agent among a shared name", () => {
    const files = [file("a1", "PC", "Dev"), file("a2", "pc", "Dev")];
    expect(picked(files, "PC", started("a2"))).toBe("a2");
  });

  it("refuses another Agent of the role the case works on", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")];
    const result = pickCaseTaskRunner(files, "a1", started("a2"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Binh-PC");
      expect(result.error).toContain("a2");
    }
  });

  it("accepts an Agent of a different role than the affinity", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "QC")];
    expect(picked(files, "a2", started("a1"))).toBe("a2");
  });

  it("gives no affinity when the Agent left the project", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")];
    expect(picked(files, "Dev", started("gone"))).toBe("a1");
  });

  it("follows the latest started task", () => {
    const files = [file("a1", "An-PC", "Dev"), file("a2", "Binh-PC", "Dev")];
    expect(picked(files, "Dev", started("a1", "a2"))).toBe("a1");
  });

  it("auto-picks an online Agent first", () => {
    const files = [
      file("a1", "An-PC", "Dev", false),
      file("a2", "Binh-PC", "Dev"),
    ];
    expect(picked(files, "Dev")).toBe("a2");
  });

  it("auto-picks free capacity, then lower load, then name", () => {
    const files = [
      file("a1", "An-PC", "Dev"),
      file("a2", "Binh-PC", "Dev"),
      file("a3", "Cuong-PC", "Dev"),
    ];
    const busy: RunnerLoad = { active: 1, queued: 0, capacity: 1 };
    const light: RunnerLoad = { active: 2, queued: 0, capacity: 4 };
    const heavy: RunnerLoad = { active: 3, queued: 0, capacity: 4 };
    const loads = (entries: [string, RunnerLoad][]): CaseRunnerContext => ({
      startedTargetIds: [],
      loads: new Map(entries),
    });
    expect(picked(files, "Dev", loads([["a1", busy]]))).toBe("a2");
    expect(
      picked(
        files,
        "Dev",
        loads([
          ["a1", busy],
          ["a2", heavy],
          ["a3", light],
        ])
      )
    ).toBe("a3");
    expect(
      picked(
        files,
        "Dev",
        loads([
          ["a1", busy],
          ["a2", busy],
        ])
      )
    ).toBe("a3");
    expect(picked(files, "Dev")).toBe("a1");
  });

  it("refuses when no candidate is online", () => {
    const files = [
      file("a1", "An-PC", "Dev", false),
      file("a2", "Binh-PC", "Dev", false),
    ];
    const result = pickCaseTaskRunner(files, "Dev", empty);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("An-PC (a1)");
      expect(result.error).toContain("Binh-PC (a2)");
    }
  });

  it("ignores affinity for an Agent without a role", () => {
    const files = [file("a1", "PC-1", null), file("a2", "PC-2", null)];
    expect(picked(files, "PC-1", started("a2"))).toBe("a1");
  });
});

describe("caseAffinity", () => {
  it("is null without a role", () => {
    expect(caseAffinity([file("a1", "PC", null)], ["a1"], null)).toBeNull();
  });
});
