import { describe, expect, it } from "vitest";
import {
  buildRunnerCapabilities,
  resolveCapabilitiesProject,
  runnerFileName,
  WORKFLOW_BUILDER_RUNNER_FILE_MAX_CHARS,
} from "../runner-catalog";

function file(name: string, id: string, content = "body") {
  return {
    computeTargetId: id,
    runnerName: name,
    source: "toolkit",
    content,
    capabilities: null,
    problems: [],
    uploadedAt: new Date().toISOString(),
  } as never;
}

describe("buildRunnerCapabilities", () => {
  it("names files by slug and compute target id", () => {
    const result = buildRunnerCapabilities({
      files: [file("Box A", "1"), file("box a", "2")],
      accessibleIds: new Set(["1", "2"]),
      now: Date.now(),
    });
    expect(result.files.map((f) => f.path)).toEqual([
      "runners/box-a-1.md",
      "runners/box-a-2.md",
    ]);
    expect(result.byTarget.get("1")?.file).toBe(result.files[0]?.path);
  });

  it("truncates long bodies", () => {
    const result = buildRunnerCapabilities({
      files: [
        file("a", "1", "x".repeat(WORKFLOW_BUILDER_RUNNER_FILE_MAX_CHARS + 10)),
      ],
      accessibleIds: new Set(["1"]),
      now: Date.now(),
    });
    expect(result.files[0]?.content.endsWith("[truncated]")).toBe(true);
  });
});

describe("resolveCapabilitiesProject", () => {
  const projects = [{ id: "p1", name: "Alpha" }];
  it("matches case-insensitively", () => {
    expect(
      resolveCapabilitiesProject({ editorYaml: "project: alpha", projects })
    ).toEqual({ ok: true, project: projects[0] });
  });
  it("fails without project", () => {
    expect(
      resolveCapabilitiesProject({
        editorYaml: "agent:\n  project: Alpha",
        projects,
      })
    ).toMatchObject({ ok: false });
  });
});

describe("runnerFileName", () => {
  it("falls back for empty and non-latin names", () => {
    expect(runnerFileName("", "t9")).toBe("runners/runner-t9.md");
    expect(runnerFileName("日本", "t9")).toBe("runners/runner-t9.md");
  });
  it("collapses unsafe characters", () => {
    expect(runnerFileName("a/b:c. ", "x")).toBe("runners/a-b-c-x.md");
  });
  it("cuts long names to 40 chars without trailing dash", () => {
    const name = `${"a".repeat(39)} ${"b".repeat(20)}`;
    const slug = runnerFileName(name, "t").slice(
      "runners/".length,
      -"-t.md".length
    );
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});
