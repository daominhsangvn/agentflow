import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RUNNER_CAPABILITIES_MAX_CHARS } from "@repo/api/src/types/runner-capabilities";
import {
  CapabilitiesFileStatus,
  capabilitiesFileAllowsStart,
  checkCapabilitiesFile,
  formatCapabilitiesProblems,
  runCapabilitiesCheck,
} from "../src/headless/headless-capabilities-check.js";
import { NO_COMMANDS_WARNING } from "../src/server/operations/capability-warnings.js";

const BAD_YAML_RE = /not valid YAML/;
const VALID = "---\ncommands:\n  - { name: /plan, mode: write }\n---\n# Dev\n";
const NO_LOG = { info: () => undefined, error: () => undefined };

function projectWith(content: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caps-check-"));
  if (content !== null) {
    fs.writeFileSync(path.join(dir, "AGENTFLOW.md"), content);
  }
  return dir;
}

function problemsOf(content: string): string[] {
  const result = checkCapabilitiesFile(projectWith(content));
  if (result.status !== CapabilitiesFileStatus.Invalid) {
    throw new Error("expected an invalid file");
  }
  return result.problems;
}

test("checkCapabilitiesFile: missing, valid", () => {
  assert.equal(
    checkCapabilitiesFile(projectWith(null)).status,
    CapabilitiesFileStatus.Missing
  );
  assert.equal(
    checkCapabilitiesFile(projectWith(VALID)).status,
    CapabilitiesFileStatus.Valid
  );
});

test("checkCapabilitiesFile: invalid files", () => {
  assert.match(problemsOf("---\ncommands: [\n---\n").join("\n"), BAD_YAML_RE);
  assert.ok(
    problemsOf(
      "---\ncommands:\n  - { name: /a, mode: maybe }\n---\n"
    )[0]?.startsWith("commands.0.mode:")
  );
  assert.ok(problemsOf("# no front matter").length > 0);
  assert.ok(
    problemsOf("x".repeat(RUNNER_CAPABILITIES_MAX_CHARS + 1)).length > 0
  );
});

test("formatCapabilitiesProblems names the file and lists each problem", () => {
  const lines = formatCapabilitiesProblems("/p/AGENTFLOW.md", ["a: x", "b: y"]);
  assert.equal(lines[0], "/p/AGENTFLOW.md is not valid (2 problems):");
  assert.deepEqual(lines.slice(1), ["  - a: x", "  - b: y"]);
});

test("capabilitiesFileAllowsStart refuses only an invalid file", () => {
  assert.equal(
    capabilitiesFileAllowsStart(projectWith("# nope"), NO_LOG, "PRO-1"),
    false
  );
  assert.equal(
    capabilitiesFileAllowsStart(projectWith(null), NO_LOG, "PRO-1"),
    true
  );
  assert.equal(
    capabilitiesFileAllowsStart(projectWith(VALID), NO_LOG, "PRO-1"),
    true
  );
});

test("runCapabilitiesCheck returns the exit code and writes the result", () => {
  const home = projectWith(null);
  const run = (content: string | null) => {
    const lines: string[] = [];
    const code = runCapabilitiesCheck({
      projectKey: "PRO-1",
      projectDir: projectWith(content),
      homeDir: home,
      write: (line) => lines.push(line),
    });
    return { code, lines };
  };

  const invalid = run("---\ncommands:\n  - { name: /a, mode: maybe }\n---\n");
  assert.equal(invalid.code, 2);
  assert.ok(invalid.lines.some((l) => l.includes("commands.0.mode")));

  const valid = run(VALID);
  assert.equal(valid.code, 0);
  assert.ok(valid.lines.some((l) => l.includes("is valid")));

  assert.equal(run(null).code, 0);

  const skillsOnly = run("---\nskills:\n  - name: tdd\n---\n");
  assert.equal(skillsOnly.code, 0);
  assert.ok(skillsOnly.lines.includes(`  warning: ${NO_COMMANDS_WARNING}`));
});
