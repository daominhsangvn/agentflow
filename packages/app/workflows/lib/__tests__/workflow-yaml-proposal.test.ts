import { WORKFLOW_BUILDER_MAX_PROBLEMS } from "@repo/api/src/types/workflow-builder";
import { proposeWorkflowOutputSchema } from "@repo/api/src/types/workflow-builder-schemas";
import { describe, expect, it } from "vitest";
import {
  JIRA_ISSUE_ASSIGNED,
  makeProjectConnections,
  PROVIDERS,
} from "../../../integrations/__tests__/integration-fixtures";
import {
  COMPUTE_TARGET_ID,
  PROJECT_ID,
  RUN_AS_USER_ID,
} from "../../__tests__/workflow-fixtures";
import { validateWorkflowProposal } from "../workflow-yaml-proposal";
import type { WorkflowYamlCatalog } from "../workflow-yaml-schema";

const CATALOG: WorkflowYamlCatalog = {
  providers: PROVIDERS,
  projectConnections: makeProjectConnections(PROJECT_ID),
  projects: [{ id: PROJECT_ID, name: "Web" }],
  users: [{ id: RUN_AS_USER_ID, name: "Ada Admin", email: "ada@acme.dev" }],
  runners: [{ id: COMPUTE_TARGET_ID, label: "runner-1", isOnline: true }],
};

const VALID_YAML = `name: Implement Jira requirements
project: Web
triggers:
  - connection: acme-jira
    type: ${JIRA_ISSUE_ASSIGNED}
    config:
      projectKeys: [PROJ]
      label: ai
agent:
  runner: runner-1
  mode: plan
actions:
  - on: workflow.triggered
    instruction: Do the work
`;

describe("validateWorkflowProposal", () => {
  it("reports a valid YAML", () => {
    const output = validateWorkflowProposal(VALID_YAML, CATALOG);

    expect(output.valid).toBe(true);
    expect(output.errorCount).toBe(0);
    expect(proposeWorkflowOutputSchema.safeParse(output).success).toBe(true);
  });

  it("reports a syntax error with its line", () => {
    const output = validateWorkflowProposal("name: [unclosed\n", CATALOG);

    expect(output.valid).toBe(false);
    expect(output.errorCount).toBeGreaterThanOrEqual(1);
    expect(output.problems.some((problem) => problem.isError)).toBe(true);
  });

  it("caps the problems and their message length", () => {
    const yaml = Array.from({ length: 80 }, (_, i) => `k${i}: [`).join("\n");
    const output = validateWorkflowProposal(
      `${yaml}\nname: ${"x".repeat(10)}`,
      CATALOG
    );

    expect(output.problems.length).toBeLessThanOrEqual(
      WORKFLOW_BUILDER_MAX_PROBLEMS
    );
    for (const problem of output.problems) {
      expect(problem.message.length).toBeLessThanOrEqual(500);
    }
    expect(proposeWorkflowOutputSchema.safeParse(output).success).toBe(true);
  });
});
