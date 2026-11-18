import { z } from "zod";
import {
  WORKFLOW_BUILDER_MAX_MESSAGES,
  WORKFLOW_BUILDER_MAX_PROBLEMS,
  WORKFLOW_BUILDER_MAX_YAML_CHARS,
} from "./workflow-builder.ts";

export const proposeWorkflowInputSchema = z.object({
  yaml: z.string().min(1).max(WORKFLOW_BUILDER_MAX_YAML_CHARS),
  summary: z.string().max(500).optional(),
});
export type ProposeWorkflowInput = z.infer<typeof proposeWorkflowInputSchema>;

export const workflowBuilderProblemSchema = z.object({
  line: z.number().int().min(0),
  message: z.string().max(500),
  isError: z.boolean(),
});
export type WorkflowBuilderProblem = z.infer<
  typeof workflowBuilderProblemSchema
>;

export const proposeWorkflowOutputSchema = z.object({
  valid: z.boolean(),
  errorCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  problems: z
    .array(workflowBuilderProblemSchema)
    .max(WORKFLOW_BUILDER_MAX_PROBLEMS),
});
export type ProposeWorkflowOutput = z.infer<typeof proposeWorkflowOutputSchema>;

export const workflowBuilderChatRequestSchema = z.object({
  messages: z.array(z.unknown()).max(WORKFLOW_BUILDER_MAX_MESSAGES),
  editorYaml: z.string().max(WORKFLOW_BUILDER_MAX_YAML_CHARS),
  workflowId: z.uuid().optional(),
});
export type WorkflowBuilderChatRequest = z.infer<
  typeof workflowBuilderChatRequestSchema
>;
