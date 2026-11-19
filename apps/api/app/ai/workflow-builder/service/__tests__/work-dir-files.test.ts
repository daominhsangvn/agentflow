import { describe, expect, it } from "vitest";
import type { KnowledgeGuide } from "../knowledge";
import {
  buildWorkflowBuilderWorkDirFiles,
  WORK_DIR_FILES,
} from "../work-dir-files";

function guide(overrides: Partial<KnowledgeGuide>): KnowledgeGuide {
  return {
    id: "yaml-reference",
    title: "YAML reference",
    kind: "reference",
    source: "docs/workflows.md",
    text: "# Reference",
    ...overrides,
  };
}

function build(
  guides: KnowledgeGuide[],
  catalog: unknown = {},
  yaml = "",
  runnerFiles: { path: string; content: string }[] = []
) {
  return buildWorkflowBuilderWorkDirFiles({
    guides,
    catalog,
    editorYaml: yaml,
    runnerFiles,
  });
}

function content(files: { path: string; content: string }[], file: string) {
  return files.find((entry) => entry.path === file)?.content;
}

describe("buildWorkflowBuilderWorkDirFiles", () => {
  it("returns guides, README, catalog and editor yaml", () => {
    const files = build([guide({})], { projects: [] }, "name: x\n");
    expect(files.map((entry) => entry.path).sort()).toEqual(
      [
        `${WORK_DIR_FILES.GuidesDir}/yaml-reference.md`,
        WORK_DIR_FILES.Readme,
        WORK_DIR_FILES.Catalog,
        WORK_DIR_FILES.EditorYaml,
      ].sort()
    );
    expect(content(files, "guides/yaml-reference.md")).toBe("# Reference");
    expect(JSON.parse(content(files, WORK_DIR_FILES.Catalog) ?? "")).toEqual({
      projects: [],
    });
    expect(content(files, WORK_DIR_FILES.EditorYaml)).toBe("name: x\n");
    const readme = content(files, WORK_DIR_FILES.Readme);
    expect(readme).toContain("| File | Title | Kind |");
    expect(readme).toContain("yaml-reference.md");
  });

  it("sanitises ids, dedupes names and keeps the yaml extension", () => {
    const files = build([
      guide({ id: "A B/c", source: "x/a.md" }),
      guide({ id: "a-b-c", source: "x/b.md" }),
      guide({ id: "example", source: "examples/flow.yml" }),
    ]);
    expect(
      files
        .map((entry) => entry.path)
        .filter((p) => p.startsWith("guides/"))
        .sort()
    ).toEqual(["guides/a-b-c-2.md", "guides/a-b-c.md", "guides/example.yaml"]);
  });

  it("says so when there are no guides", () => {
    const files = build([]);
    expect(content(files, WORK_DIR_FILES.Readme)).toContain(
      "No guides are available."
    );
    expect(files.some((entry) => entry.path.startsWith("guides/"))).toBe(false);
  });

  it("includes runner files and lists them in the README", () => {
    const files = build([], {}, "", [
      { path: "runners/box.md", content: "# body" },
    ]);
    expect(content(files, "runners/box.md")).toBe("# body");
    const readme = content(files, WORK_DIR_FILES.Readme);
    expect(readme).toContain("| Runner file |");
    expect(readme).toContain("runners/box.md");
  });

  it("says so when there are no runner files", () => {
    expect(content(build([]), WORK_DIR_FILES.Readme)).toContain(
      "No runner files."
    );
  });
});
