import { AgentKind } from "@repo/api/src/types/agent-fleet";
import { ProcessStepType } from "@repo/api/src/types/project-process";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { YamlProblemSeverity } from "@repo/app/shared/lib/yaml-problems";
import { describe, expect, it } from "vitest";
import {
  JIRA_ISSUE_ASSIGNED,
  makeProjectConnections,
  PROVIDERS,
} from "../../../integrations/__tests__/integration-fixtures";
import {
  COMPUTE_TARGET_ID,
  makeWorkflow,
  PROJECT_ID,
  RUN_AS_USER_ID,
} from "../../__tests__/workflow-fixtures";
import {
  parseWorkflowYaml,
  workflowYamlProblems,
  workflowYamlProjectId,
  workflowYamlTriggerProjectIds,
} from "../workflow-yaml";
import type { WorkflowYamlCatalog } from "../workflow-yaml-schema";
import { workflowToYaml } from "../workflow-yaml-write";

const BETA_ID = "22222222-2222-4222-8222-222222222222";

const CATALOG: WorkflowYamlCatalog = {
  providers: PROVIDERS,
  projectConnections: [
    ...makeProjectConnections(PROJECT_ID),
    ...makeProjectConnections(BETA_ID),
  ],
  projects: [
    { id: PROJECT_ID, name: "Alpha" },
    { id: BETA_ID, name: "Beta" },
  ],
  users: [{ id: RUN_AS_USER_ID, name: "Ada Admin", email: "ada@acme.dev" }],
  runners: [
    {
      id: COMPUTE_TARGET_ID,
      label: "PRO-1-BA",
      isOnline: true,
      kind: AgentKind.Personal,
    },
  ],
};

const HEAD = `name: Fit
project: Alpha
triggers:
  - connection: acme-jira
    type: ${JIRA_ISSUE_ASSIGNED}
    config:
      projectKeys: [PROJ]
      label: ai
`;
const ACTIONS = `actions:
  - on: workflow.triggered
    instruction: Do the work
`;

const ASK_PROCESS = {
  steps: [
    {
      type: ProcessStepType.Agent,
      id: "ask",
      name: "Ask",
      instruction: "/ask",
    },
  ],
} as never;

function withProcesses(
  processes: Record<string, typeof ASK_PROCESS | null>
): WorkflowYamlCatalog {
  return {
    ...CATALOG,
    runnerFit: { projectId: PROJECT_ID, processes, commands: {} },
  };
}

function yamlOf(agent: string, head = HEAD): string {
  return `${head}agent:\n  runner: PRO-1-BA\n${agent}${ACTIONS}`;
}

function processOf(instruction: string, extra = ""): string {
  return `  process:\n    steps:\n      - type: agent\n        id: ask\n        name: Ask\n        instruction: ${instruction}\n${extra}`;
}

function lineOf(text: string, needle: string): number {
  return text.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

describe("workflow YAML runner fit", () => {
  it("refuses a personal runner with a mode and no process", () => {
    const text = yamlOf("  mode: plan\n");
    const result = parseWorkflowYaml(
      text,
      withProcesses({ [PROJECT_ID]: null })
    );

    expect(result.input).toBeNull();
    const problem = result.problems.find(
      (item) => item.severity === YamlProblemSeverity.Error
    );
    expect(problem?.message).toContain("personal runner");
    expect(problem?.line).toBe(lineOf(text, "runner: PRO-1-BA"));
  });

  it("accepts a personal runner with an agent-step process", () => {
    const result = parseWorkflowYaml(yamlOf(processOf("/ask hi")), CATALOG);

    expect(result.input).not.toBeNull();
  });

  it("refuses finish: push on the finish line", () => {
    const text = yamlOf(processOf("/ask hi", "        finish: push\n"));
    const result = parseWorkflowYaml(text, CATALOG);

    expect(result.input).toBeNull();
    expect(
      result.problems.find((item) => item.message.includes("finish: push"))
        ?.line
    ).toBe(lineOf(text, "finish: push"));
  });

  it("warns on an undeclared command and still validates", () => {
    const catalog: WorkflowYamlCatalog = {
      ...CATALOG,
      runnerFit: {
        projectId: PROJECT_ID,
        processes: { [PROJECT_ID]: null },
        commands: { [COMPUTE_TARGET_ID]: ["/ask"] },
      },
    };
    const result = parseWorkflowYaml(yamlOf(processOf("/other x")), catalog);

    expect(result.input).not.toBeNull();
    expect(
      result.problems.find((item) => item.message.includes("/other"))?.severity
    ).toBe(YamlProblemSeverity.Warning);
  });

  it("warns that mode is ignored next to a process", () => {
    const result = parseWorkflowYaml(
      yamlOf(`  mode: plan\n${processOf("/ask hi")}`),
      CATALOG
    );

    expect(
      result.problems.some(
        (item) =>
          item.message.includes("mode is ignored") &&
          item.severity === YamlProblemSeverity.Warning
      )
    ).toBe(true);
    expect(result.input).not.toBeNull();
  });

  it("accepts the project's own process of agent steps", () => {
    const catalog: WorkflowYamlCatalog = {
      ...CATALOG,
      runnerFit: {
        projectId: PROJECT_ID,
        processes: { [PROJECT_ID]: ASK_PROCESS },
        commands: {},
      },
    };

    expect(
      parseWorkflowYaml(yamlOf("  mode: plan\n"), catalog).input
    ).not.toBeNull();
  });

  it("skips the fit rules for an orchestrated workflow", () => {
    const text = yamlOf(
      `  mode: ${WorkflowAgentMode.Orchestrated}\n  orchestrator:\n    cancelOn: [comment]\n`
    );
    const problems = workflowYamlProblems(text, CATALOG);

    expect(problems.some((item) => item.message.includes("personal"))).toBe(
      false
    );
  });

  it("finds the project of the root project: key only", () => {
    expect(workflowYamlProjectId("project: alpha\n", CATALOG)).toBe(PROJECT_ID);
    expect(
      workflowYamlProjectId("agent:\n  project: Alpha\n", CATALOG)
    ).toBeNull();
    expect(workflowYamlProjectId("project: [", CATALOG)).toBeNull();
  });

  it("leaves mode out of the YAML of a workflow with a process", () => {
    const base = makeWorkflow();
    const withProcess = makeWorkflow({
      agent: { ...base.agent, process: ASK_PROCESS },
    });
    const catalog = { ...CATALOG, projects: [{ id: PROJECT_ID, name: "Web" }] };

    expect(workflowToYaml(withProcess, catalog)).not.toContain("mode:");
    expect(workflowToYaml(base, catalog)).toContain("mode:");
  });

  it("requires a root project: that names a project", () => {
    const missing = parseWorkflowYaml(
      yamlOf(processOf("/ask hi"), HEAD.replace("project: Alpha\n", "")),
      CATALOG
    );
    const unknown = parseWorkflowYaml(
      yamlOf(processOf("/ask hi"), HEAD.replace("Alpha", "Nope")),
      CATALOG
    );

    for (const result of [missing, unknown]) {
      expect(result.input).toBeNull();
      expect(
        result.problems.some((item) =>
          item.message.includes("required to resolve runners and capabilities")
        )
      ).toBe(true);
    }
  });

  it("makes an agent.project-only YAML an error on that line", () => {
    const head = HEAD.replace("project: Alpha\n", "");
    const text = yamlOf(`  project: Alpha\n${processOf("/ask hi")}`, head);
    const result = parseWorkflowYaml(text, CATALOG);

    expect(result.input).toBeNull();
    expect(
      result.problems.find((item) => item.message.includes("older place"))?.line
    ).toBe(lineOf(text, "project: Alpha"));
  });

  it("skips the project-process rule without runnerFit", () => {
    const result = parseWorkflowYaml(yamlOf("  mode: plan\n"), CATALOG);

    expect(result.input).not.toBeNull();
  });

  it("skips the project-process rule for an unknown process", () => {
    const result = parseWorkflowYaml(
      yamlOf("  mode: plan\n"),
      withProcesses({})
    );

    expect(result.input).not.toBeNull();
  });

  it("still checks an own process when the project process is unknown", () => {
    const text = yamlOf(
      "  process:\n    steps:\n      - type: agentflow.plan\n        id: plan\n        name: Plan\n"
    );
    const result = parseWorkflowYaml(text, withProcesses({}));

    expect(result.input).toBeNull();
    expect(
      result.problems.find((item) => item.message.includes("PLAN/EXECUTE"))
        ?.line
    ).toBe(lineOf(text, "type: agentflow.plan"));
  });

  describe("trigger projects", () => {
    const betaHead = `${HEAD}    project: Beta\n`;

    it("reports the process of a trigger project that has none", () => {
      const result = parseWorkflowYaml(
        yamlOf("  mode: plan\n", betaHead),
        withProcesses({ [PROJECT_ID]: ASK_PROCESS, [BETA_ID]: null })
      );

      expect(result.input).toBeNull();
      expect(
        result.problems.some((item) =>
          item.message.startsWith("Runs of trigger project Beta:")
        )
      ).toBe(true);
    });

    it("skips a trigger project whose process is unknown", () => {
      const result = parseWorkflowYaml(
        yamlOf("  mode: plan\n", betaHead),
        withProcesses({ [PROJECT_ID]: ASK_PROCESS })
      );

      expect(result.input).not.toBeNull();
    });
  });

  it("lists the projects the triggers name", () => {
    const text = `triggers:
  - connection: a
    project: beta
  - connection: b
  - connection: c
    project: Nope
  - connection: d
    project: Beta\n`;

    expect(workflowYamlTriggerProjectIds(text, CATALOG)).toEqual([BETA_ID]);
    expect(workflowYamlTriggerProjectIds("triggers: [", CATALOG)).toEqual([]);
  });
});
