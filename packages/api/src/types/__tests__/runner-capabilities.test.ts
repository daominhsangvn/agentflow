import { describe, expect, it } from "vitest";
import {
  parseRunnerCapabilitiesMarkdown,
  RunnerCapabilitiesSource,
  RunnerCommandMode,
  runnerCapabilitiesGitCredentialPath,
  runnerCapabilitiesRefreshRequestSchema,
  runnerCapabilitiesRefreshResultSchema,
  runnerRoleSchema,
  unknownRunnerCapabilitiesKeys,
  uploadRunnerCapabilitiesInputSchema,
} from "../runner-capabilities";

const NOT_YAML_RE = /not valid YAML/;
const NAME_PROBLEM_RE = /^commands\.0\.name: /;
const ATTACH_PROBLEM_RE = /^commands\.0\.attach\.0: /;
const MODE_PROBLEM_RE = /^commands\.0\.mode: /;

const FILE = `---
runner: Dev (LeaveDesk)
commands:
  - name: /plan-ticket
    args: <ticket-key>
    mode: write
    produces: plan
    needs: [prd]
    asks: true
  - name: /explain-code
    mode: read
    produces: answer
skills:
  - tdd
  - name: systematic-debugging
    description: Find the root cause first
---

# Dev runner

## /plan-ticket
Writes the plan.
`;

describe("parseRunnerCapabilitiesMarkdown", () => {
  it("reads the commands, skills and body", () => {
    const result = parseRunnerCapabilitiesMarkdown(FILE);
    expect(result).toEqual({
      ok: true,
      value: {
        runner: "Dev (LeaveDesk)",
        toolkit: null,
        commands: [
          {
            name: "/plan-ticket",
            args: "<ticket-key>",
            mode: RunnerCommandMode.Write,
            produces: "plan",
            needs: ["prd"],
            asks: true,
          },
          {
            name: "/explain-code",
            mode: RunnerCommandMode.Read,
            produces: "answer",
          },
        ],
        skills: [
          { name: "tdd" },
          {
            name: "systematic-debugging",
            description: "Find the root cause first",
          },
        ],
      },
      body: "# Dev runner\n\n## /plan-ticket\nWrites the plan.",
    });
  });

  it("accepts a front matter without commands", () => {
    const result = parseRunnerCapabilitiesMarkdown("---\nskills: [tdd]\n---\n");
    expect(result.ok && result.value.commands).toEqual([]);
  });

  it("refuses a file without front matter", () => {
    const result = parseRunnerCapabilitiesMarkdown("# Dev runner\n");
    expect(result.ok).toBe(false);
  });

  it("refuses YAML that does not parse", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      "---\ncommands: [\n---\nbody"
    );
    expect(!result.ok && result.problems[0]).toMatch(NOT_YAML_RE);
  });

  it("names the field of a schema problem", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      "---\ncommands:\n  - name: plan-ticket\n    mode: maybe\n---\n"
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toEqual([
      expect.stringMatching(NAME_PROBLEM_RE),
      expect.stringMatching(MODE_PROBLEM_RE),
    ]);
  });

  it("refuses a command listed twice", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      "---\ncommands:\n  - { name: /a, mode: read }\n  - { name: /a, mode: write }\n---\n"
    );
    expect(!result.ok && result.problems).toEqual([
      "commands: /a is listed twice",
    ]);
  });

  it("reads an auto runner's toolkit", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      "---\ntoolkit:\n  repository: workshop/leavedesk-knowledge\n  mounts: [.claude/agents, .claude/skills]\ncommands:\n  - { name: /ba-requirement, mode: read }\n---\n"
    );
    expect(result.ok && result.value.toolkit).toEqual({
      repository: "workshop/leavedesk-knowledge",
      mounts: [".claude/agents", ".claude/skills"],
    });
  });

  it("keeps the attach globs of a command", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      '---\ncommands:\n  - { name: /a, mode: write, attach: ["PRD-*.md", "evidence-*/*.png"] }\n---\n'
    );
    expect(result.ok && result.value.commands[0]?.attach).toEqual([
      "PRD-*.md",
      "evidence-*/*.png",
    ]);
  });

  it.each(["../x.md", "/abs.md"])("refuses the attach glob %s", (glob) => {
    const result = parseRunnerCapabilitiesMarkdown(
      `---\ncommands:\n  - { name: /a, mode: write, attach: ["${glob}"] }\n---\n`
    );
    expect(!result.ok && result.problems).toEqual([
      expect.stringMatching(ATTACH_PROBLEM_RE),
    ]);
  });

  describe("attachRoots", () => {
    const doc = (front: string) => `---\n${front}\n---\nbody`;
    const cmd = (glob: string) =>
      `commands:\n  - name: /a\n    mode: write\n    attach: ["${glob}"]\n    attachChanged: true`;

    it("parses declared roots and attachChanged", () => {
      const r = parseRunnerCapabilitiesMarkdown(
        doc(`attachRoots:\n  features: ../f\n${cmd("features:**/*.md")}`)
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.attachRoots).toEqual({ features: "../f" });
        expect(r.value.commands[0]?.attachChanged).toBe(true);
      }
    });

    it("accepts the built-in project root", () => {
      expect(
        parseRunnerCapabilitiesMarkdown(doc(cmd("project:docs/*.md"))).ok
      ).toBe(true);
    });

    it("has no attachRoots key when none is declared", () => {
      const r = parseRunnerCapabilitiesMarkdown(doc(cmd("PRD-*.md")));
      expect(r.ok && "attachRoots" in r.value).toBe(false);
    });

    it("refuses an undeclared root", () => {
      const r = parseRunnerCapabilitiesMarkdown(doc(cmd("nope:a.md")));
      expect(r.ok).toBe(false);
    });

    it("refuses declaring project", () => {
      const r = parseRunnerCapabilitiesMarkdown(
        doc("attachRoots:\n  project: ../x\ncommands: []")
      );
      expect(r.ok).toBe(false);
    });

    it("refuses .. after the prefix", () => {
      const r = parseRunnerCapabilitiesMarkdown(
        doc(`attachRoots:\n  features: ../f\n${cmd("features:../x")}`)
      );
      expect(r.ok).toBe(false);
    });

    it("refuses a bad root name", () => {
      const r = parseRunnerCapabilitiesMarkdown(
        doc("attachRoots:\n  Features: ../f\ncommands: []")
      );
      expect(r.ok).toBe(false);
    });
  });

  it("refuses a toolkit mount outside the repository", () => {
    const result = parseRunnerCapabilitiesMarkdown(
      "---\ntoolkit:\n  repository: workshop/kb\n  mounts: [../secrets]\n---\n"
    );
    expect(result.ok).toBe(false);
  });
});

describe("capabilities refresh contract", () => {
  const request = {
    refreshId: "0b6f4f3e-5a52-4c3a-8d3e-0d6a8f1d2c11",
    projectId: "1c7a5a4f-6b63-4d4b-9e4f-1e7b9a2e3d22",
    repository: "workshop/leavedesk-knowledge",
    cloneUrl: "https://git.example.com/workshop/leavedesk-knowledge.git",
    defaultBranch: "main",
  };

  it("parses a valid request", () => {
    expect(
      runnerCapabilitiesRefreshRequestSchema.safeParse(request).success
    ).toBe(true);
  });

  it("rejects a non-uuid refreshId", () => {
    expect(
      runnerCapabilitiesRefreshRequestSchema.safeParse({
        ...request,
        refreshId: "nope",
      }).success
    ).toBe(false);
  });

  it("parses both result branches", () => {
    expect(
      runnerCapabilitiesRefreshResultSchema.safeParse({
        type: "result",
        ok: true,
        contentHash: "abc",
        warningCount: 0,
      }).success
    ).toBe(true);
    expect(
      runnerCapabilitiesRefreshResultSchema.safeParse({
        type: "result",
        ok: false,
        error: "boom",
      }).success
    ).toBe(true);
  });

  it("encodes the git credential path", () => {
    expect(runnerCapabilitiesGitCredentialPath("a b", "c")).toBe(
      "/compute-targets/a%20b/capabilities/refresh/c/git-credential"
    );
  });
});

describe("runnerRoleSchema", () => {
  it("trims and accepts up to 120 characters", () => {
    expect(runnerRoleSchema.parse("  Dev (LeaveDesk, An) ")).toBe(
      "Dev (LeaveDesk, An)"
    );
    expect(runnerRoleSchema.safeParse("a".repeat(120)).success).toBe(true);
  });

  it("rejects empty, blank and too long roles", () => {
    expect(runnerRoleSchema.safeParse("").success).toBe(false);
    expect(runnerRoleSchema.safeParse("   ").success).toBe(false);
    expect(runnerRoleSchema.safeParse("a".repeat(121)).success).toBe(false);
  });
});

describe("uploadRunnerCapabilitiesInputSchema role", () => {
  const base = {
    project: "PRO-1",
    source: RunnerCapabilitiesSource.Personal,
    content: "x",
  };

  it("accepts with and without a role", () => {
    expect(uploadRunnerCapabilitiesInputSchema.safeParse(base).success).toBe(
      true
    );
    expect(
      uploadRunnerCapabilitiesInputSchema.safeParse({ ...base, role: "Dev" })
        .success
    ).toBe(true);
  });

  it("rejects a 121-character role", () => {
    expect(
      uploadRunnerCapabilitiesInputSchema.safeParse({
        ...base,
        role: "a".repeat(121),
      }).success
    ).toBe(false);
  });
});

describe("unknownRunnerCapabilitiesKeys", () => {
  it("returns nothing for a file without extras", () => {
    expect(unknownRunnerCapabilitiesKeys(FILE)).toEqual([]);
  });

  it("names a misspelled top-level key", () => {
    expect(
      unknownRunnerCapabilitiesKeys("---\ncomands:\n  - name: /a\n---\n")
    ).toEqual(["comands"]);
  });

  it("names an unknown key of a command", () => {
    expect(
      unknownRunnerCapabilitiesKeys(
        "---\ncommands:\n  - name: /a\n    descripton: x\n---\n"
      )
    ).toEqual(["commands.0.descripton"]);
  });

  it("names an unknown key of the toolkit", () => {
    expect(
      unknownRunnerCapabilitiesKeys(
        "---\ntoolkit:\n  repository: a/b\n  mounts: []\n  extra: 1\n---\n"
      )
    ).toEqual(["toolkit.extra"]);
  });

  it("returns nothing when the file does not parse", () => {
    expect(unknownRunnerCapabilitiesKeys("# none")).toEqual([]);
    expect(unknownRunnerCapabilitiesKeys("---\ncommands: [\n---\n")).toEqual(
      []
    );
  });
});
