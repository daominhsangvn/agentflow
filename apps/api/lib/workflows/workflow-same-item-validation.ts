import type { WorkflowAgentConfig } from "@repo/api/src/types/workflow";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";

/**
 * An orchestrated workflow takes a thread's messages through
 * `agent.orchestrator.concurrency`, so `agent.sameItem` (a process-mode
 * setting) is refused for it. `ignore` is the default and is accepted.
 */
export function orchestratedSameItemError(
  sameItem: WorkflowAgentConfig["sameItem"]
): string | null {
  if (sameItem && sameItem !== WorkflowSameItem.Ignore) {
    return "agent.sameItem: an orchestrated workflow takes a thread's messages through agent.orchestrator.concurrency; remove agent.sameItem.";
  }
  return null;
}
