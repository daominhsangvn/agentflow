import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  collectNamedAttachEntries,
  readLocalAttachRoots,
} from "../src/server/operations/attach-roots.js";
import { matchStepFiles } from "../src/server/operations/loop-step.js";

const OUTSIDE_F_RE = /outside f/;
const UNKNOWN_ROOT_RE = /other is not in attachRoots/;
const base = mkdtempSync(path.join(os.tmpdir(), "attach-roots-"));
after(() => rmSync(base, { recursive: true, force: true }));

let counter = 0;

function setup(agentflow: string | null) {
  counter += 1;
  const dir = path.join(base, `case-${counter}`);
  const project = path.join(dir, "project");
  mkdirSync(project, { recursive: true });
  if (agentflow !== null) {
    writeFileSync(path.join(project, "AGENTFLOW.md"), agentflow);
  }
  return { dir, project };
}

function put(file: string, content = "x") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function front(roots: string, glob: string): string {
  return `---\nattachRoots:\n${roots}\ncommands:\n  - name: /c\n    mode: write\n    attach:\n      - "${glob}"\n---\nbody\n`;
}

describe("named attach roots", () => {
  test("a relative root is collected as <name>:<relative>", () => {
    const { dir, project } = setup(
      front("  features: ../shared", "features:**/*.md")
    );
    put(path.join(dir, "shared", "a", "b.md"));
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["features:**/*.md"],
      match: matchStepFiles,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "features:a/b.md");
    assert.equal(entries[0].skipped, undefined);
  });

  test("a ~/ root uses the injected home", () => {
    const { dir, project } = setup(front("  notes: ~/notes", "notes:*.md"));
    put(path.join(dir, "home", "notes", "n.md"));
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["notes:*.md"],
      match: matchStepFiles,
      homeDir: path.join(dir, "home"),
    });
    assert.deepEqual(
      entries.map((e) => e.path),
      ["notes:n.md"]
    );
  });

  test("project: collects from the project but not .agentflow-ai", () => {
    const { project } = setup(front("  a: ../a", "project:docs/*.md"));
    put(path.join(project, "docs", "d.md"));
    put(path.join(project, ".agentflow-ai", "runs", "x", "y.md"));
    const docs = collectNamedAttachEntries({
      projectDir: project,
      globs: ["project:docs/*.md", "project:.agentflow-ai/runs/x/*.md"],
      match: matchStepFiles,
    });
    assert.deepEqual(
      docs.map((e) => e.path),
      ["project:docs/d.md"]
    );
  });

  test("project: hides .agentflow-ai through ./ and through a symlink", () => {
    const { project } = setup(front("  a: ../a", "project:docs/*.md"));
    put(path.join(project, ".agentflow-ai", "runs", "y.md"));
    symlinkSync(
      path.join(project, ".agentflow-ai"),
      path.join(project, "link")
    );
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["project:./.agentflow-ai/runs/*.md", "project:link/runs/*.md"],
      match: matchStepFiles,
    });
    assert.ok(entries.every((e) => e.file === ""));
    assert.ok(entries.every((e) => !e.path.includes("y.md") || e.skipped));
  });

  test("project: hides an upper-case .AGENTFLOW-AI folder and a symlink to it", () => {
    const { project } = setup(front("  a: ../a", "project:docs/*.md"));
    put(path.join(project, ".AGENTFLOW-AI", "runs", "y.md"));
    symlinkSync(
      path.join(project, ".AGENTFLOW-AI"),
      path.join(project, "link")
    );
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["project:.AGENTFLOW-AI/runs/*.md", "project:link/runs/*.md"],
      match: matchStepFiles,
    });
    assert.ok(entries.every((e) => e.file === ""));
  });

  test("project: an upper-case glob over .agentflow-ai reads nothing", () => {
    const { project } = setup(front("  a: ../a", "project:docs/*.md"));
    put(path.join(project, ".agentflow-ai", "runs", "y.md"));
    symlinkSync(
      path.join(project, ".agentflow-ai"),
      path.join(project, "Link")
    );
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["project:.AGENTFLOW-AI/runs/*.md", "project:LINK/runs/*.md"],
      match: matchStepFiles,
    });
    // On a case-sensitive filesystem nothing matches; on a case-insensitive
    // one the realpath carries the on-disk case and is still hidden.
    assert.ok(entries.every((e) => e.file === ""));
  });

  test("an unknown name is skipped with a reason", () => {
    const { project } = setup(front("  a: ../a", "a:*.md"));
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["other:*.md"],
      match: () => {
        throw new Error("must not read");
      },
    });
    assert.equal(entries.length, 1);
    assert.match(entries[0].skipped ?? "", UNKNOWN_ROOT_RE);
  });

  test("a symlinked subfolder pointing outside is not collected", () => {
    const { dir, project } = setup(front("  f: ../shared", "f:**/*.md"));
    put(path.join(dir, "shared", "ok.md"));
    put(path.join(dir, "secret", "s.md"));
    symlinkSync(path.join(dir, "secret"), path.join(dir, "shared", "link"));
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["f:link/*.md"],
      match: matchStepFiles,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "f:link/s.md");
    assert.match(entries[0].skipped ?? "", OUTSIDE_F_RE);
    assert.equal(entries[0].file, "");
  });

  test("a symlinked file escaping the root is not collected", () => {
    const { dir, project } = setup(front("  f: ../shared", "f:*.md"));
    put(path.join(dir, "secret.md"));
    mkdirSync(path.join(dir, "shared"), { recursive: true });
    symlinkSync(path.join(dir, "secret.md"), path.join(dir, "shared", "l.md"));
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["f:*.md"],
      match: (root, globs) => [...matchStepFiles(root, globs), "l.md"],
    });
    assert.ok(entries.every((e) => e.skipped !== undefined || e.file !== ""));
    assert.ok(entries.every((e) => !e.file.endsWith("secret.md")));
  });

  test("a missing AGENTFLOW.md skips the glob", () => {
    const { project } = setup(null);
    assert.deepEqual(readLocalAttachRoots(project), {
      error: "AGENTFLOW.md is missing",
    });
    const entries = collectNamedAttachEntries({
      projectDir: project,
      globs: ["f:*.md"],
      match: matchStepFiles,
    });
    assert.equal(entries[0].skipped, "AGENTFLOW.md is missing");
  });
});
