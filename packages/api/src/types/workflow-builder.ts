import { PlatformAgentDisabledReason } from "./platform-agent.ts";

/**
 * Tool names shared by the workflow builder assistant (server) and its chat UI (browser).
 * `list_guides` / `read_guide` / `get_catalog` now label server-side file reads (kept for the chat
 * labels and stored chats); `propose_workflow` is answered by the browser.
 */
export const WorkflowBuilderToolName = {
  ListGuides: "list_guides",
  ReadGuide: "read_guide",
  GetCatalog: "get_catalog",
  ProposeWorkflow: "propose_workflow",
} as const;
export type WorkflowBuilderToolName =
  (typeof WorkflowBuilderToolName)[keyof typeof WorkflowBuilderToolName];

/** Why the workflow builder assistant is disabled: not configured, or a platform agent reason. */
export const WorkflowBuilderDisabledReason = {
  NotConfigured: "workflow_builder_not_configured",
  ...PlatformAgentDisabledReason,
} as const;
export type WorkflowBuilderDisabledReason =
  (typeof WorkflowBuilderDisabledReason)[keyof typeof WorkflowBuilderDisabledReason];

export const WorkflowBuilderErrorCode = {
  NotConfigured: WorkflowBuilderDisabledReason.NotConfigured,
  Unavailable: "workflow_builder_unavailable",
  RateLimited: "workflow_builder_rate_limited",
  Busy: "workflow_builder_busy",
} as const;
export type WorkflowBuilderErrorCode =
  (typeof WorkflowBuilderErrorCode)[keyof typeof WorkflowBuilderErrorCode];

export type WorkflowBuilderStatus = {
  enabled: boolean;
  reason?: WorkflowBuilderDisabledReason;
};

export const WORKFLOW_BUILDER_STATUS_PATH = "/ai/workflow-builder/status";
export const WORKFLOW_BUILDER_CHAT_PATH = "/ai/workflow-builder/chat";

export const WORKFLOW_BUILDER_MAX_MESSAGES = 60;
export const WORKFLOW_BUILDER_MAX_YAML_CHARS = 64_000;
export const WORKFLOW_BUILDER_MAX_PROBLEMS = 30;
export const WORKFLOW_BUILDER_CHAT_BODY_MAX_BYTES = 1024 * 1024;
