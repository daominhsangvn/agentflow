import type { Workflow } from "@repo/api/src/types/workflow";
import { WORKFLOW_BUILDER_MAX_PROBLEMS } from "@repo/api/src/types/workflow-builder";
import type { ProposeWorkflowOutput } from "@repo/api/src/types/workflow-builder-schemas";
import { YamlProblemSeverity } from "@repo/app/shared/lib/yaml-problems";
import { parseWorkflowYaml } from "./workflow-yaml";
import type { WorkflowYamlCatalog } from "./workflow-yaml-schema";

const MAX_PROBLEM_MESSAGE_CHARS = 500;

/**
 * Checks a YAML proposed by the workflow builder assistant exactly as the
 * editor checks typed YAML, and reduces the problems to the tool output the
 * agent reads (capped, by line).
 */
export function validateWorkflowProposal(
  yaml: string,
  catalog: WorkflowYamlCatalog,
  saved?: Workflow
): ProposeWorkflowOutput {
  const result = parseWorkflowYaml(yaml, catalog, saved);
  const errorCount = result.problems.filter(
    (problem) => problem.severity === YamlProblemSeverity.Error
  ).length;
  return {
    valid: result.input !== null,
    errorCount,
    warningCount: result.problems.length - errorCount,
    problems: result.problems
      .slice(0, WORKFLOW_BUILDER_MAX_PROBLEMS)
      .map((problem) => ({
        line: problem.line,
        message: problem.message.slice(0, MAX_PROBLEM_MESSAGE_CHARS),
        isError: problem.severity === YamlProblemSeverity.Error,
      })),
  };
}
