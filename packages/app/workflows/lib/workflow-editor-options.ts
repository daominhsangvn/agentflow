/**
 * A desktop compute target the workflow's loops can run on, as offered by the
 * editor. Compute targets are read by a web-shell hook (they need the
 * desktop command-signing cache), so the shell maps them to this shape and
 * passes them into the shared editor as props.
 */
export type WorkflowComputeTargetOption = {
  id: string;
  label: string;
  /** Secondary text, e.g. the owner or "Shared with the organization". */
  description?: string;
  isOnline: boolean;
};

/** The compute target choices the shell hands to the workflow editor. */
export type WorkflowComputeTargetChoices = {
  options: readonly WorkflowComputeTargetOption[];
  isLoading: boolean;
  error: Error | null;
};

/**
 * The Agents to suggest: only the project's Agents when it has some, else all
 * of them.
 */
export function projectAgentOptions(
  options: readonly WorkflowComputeTargetOption[],
  runnerIds: readonly string[]
): readonly WorkflowComputeTargetOption[] {
  if (runnerIds.length === 0) {
    return options;
  }
  return options.filter((option) => runnerIds.includes(option.id));
}
