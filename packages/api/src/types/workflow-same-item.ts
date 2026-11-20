export const WorkflowSameItem = {
  Ignore: "ignore",
  Queue: "queue",
  QueueResume: "queue_resume",
} as const;
export type WorkflowSameItem =
  (typeof WorkflowSameItem)[keyof typeof WorkflowSameItem];

export const WORKFLOW_SAME_ITEM_DESCRIPTIONS: Record<WorkflowSameItem, string> =
  {
    [WorkflowSameItem.Ignore]:
      "An event on an item with an active run is ignored (default)",
    [WorkflowSameItem.Queue]:
      "Each event starts its own run; runs of one item run one after another, each after the previous one's reply",
    [WorkflowSameItem.QueueResume]:
      "Like queue, and a run continues the agent session of the item's previous run on the runner that ran it",
  };

export const WorkflowSessionCarryAttempt = {
  /** Plain `--resume` of the previous run's session. */
  Resume: "resume",
  /** `--resume --fork-session` after the runner did not find the session. */
  Fork: "fork",
  /** A new session with the full thread. */
  Fresh: "fresh",
} as const;
export type WorkflowSessionCarryAttempt =
  (typeof WorkflowSessionCarryAttempt)[keyof typeof WorkflowSessionCarryAttempt];

export const WorkflowSessionCarryReason = {
  /** The workflow's sameItem setting does not continue sessions. */
  NotResume: "same_item_not_resume",
  /** The run was resumed or retried (cycle above 1). */
  NotFirstCycle: "not_first_cycle",
  /** No earlier run of the item exists. */
  NoPreviousRun: "no_previous_run",
  /** The earlier run has no agent session. */
  NoSession: "no_previous_session",
  /** The chain of continued sessions reached the depth cap. */
  DepthLimit: "session_depth_limit",
  /** The runner of the earlier session cannot be used for this run. */
  RunnerUnavailable: "previous_runner_unavailable",
  /** The runner's version cannot report a missing resume session. */
  RunnerCannotReportMiss: "runner_cannot_report_resume_miss",
  /** The first step pushes a branch on an auto runner. */
  PushingStepOnAuto: "pushing_step_on_auto_runner",
  /** The step's files are outside the reset work folder on an auto runner. */
  ArtifactsOutsideWorkDir: "artifacts_outside_work_dir",
  /** The earlier run's folder on the auto runner is unknown. */
  WorkspaceUnknown: "previous_workspace_unknown",
  /** The runner no longer had the session (plain resume). */
  ResumeSessionNotFound: "resume_session_not_found",
  /** The runner no longer had the session (fork). */
  ForkSessionNotFound: "fork_session_not_found",
  /** The earlier session's runner could not start the carried attempt. */
  CarriedLaunchFailed: "carried_launch_failed",
} as const;
export type WorkflowSessionCarryReason =
  (typeof WorkflowSessionCarryReason)[keyof typeof WorkflowSessionCarryReason];

export type WorkflowRunSessionCarry = {
  /**
   * The run whose session was continued or tried; null when none was found.
   */
  fromRunId: string | null;
  attempt: WorkflowSessionCarryAttempt;
  /** Why the attempt is not a plain resume; null for a plain resume. */
  reason: WorkflowSessionCarryReason | null;
};
