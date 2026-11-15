// SDK-free attribute and outcome keys. Imported by browser-bundled code, so
// this file must not import anything from `@opentelemetry/*`.

export const AfAttribute = {
  OrgId: "af.org_id",
  ProjectId: "af.project_id",
  CaseId: "af.case_id",
  TaskId: "af.task_id",
  LoopId: "af.loop_id",
  WorkflowRunId: "af.workflow_run_id",
  ComputeTargetId: "af.compute_target_id",
  UserId: "af.user_id",
  AuthMethod: "af.auth_method",
  ConversationId: "af.conversation_id",
  TurnId: "af.turn_id",
  ActionRunId: "af.action_run_id",
  ConnectionId: "af.connection_id",
  DeliveryId: "af.delivery_id",
  IntegrationProvider: "af.integration.provider",
  CommandId: "af.command_id",
  OperationId: "af.operation_id",
  CronJob: "af.cron.job",
  Outcome: "af.outcome",
  ErrorReason: "af.error.reason",
} as const;
export type AfAttribute = (typeof AfAttribute)[keyof typeof AfAttribute];

export const AfOutcome = {
  Ok: "ok",
  Error: "error",
  Skipped: "skipped",
  Ignored: "ignored",
  Duplicate: "duplicate",
  Retry: "retry",
  Rejected: "rejected",
} as const;
export type AfOutcome = (typeof AfOutcome)[keyof typeof AfOutcome];
