import {
  OrchestratorPageOperation,
  OrchestratorPullRequestOperation,
  OrchestratorSourceOperation,
} from "@repo/api/src/types/orchestrator-grants";

/** Every write granted: comment and attach, publish on `docs`, open pull requests. */
export const FULL_GRANTS = {
  source: [
    OrchestratorSourceOperation.Comment,
    OrchestratorSourceOperation.Attach,
  ],
  docs: [OrchestratorPageOperation.Publish],
  pull_requests: [OrchestratorPullRequestOperation.Open],
};

/** The mock of `loadOrchestratorWorkflows` for one workflow with `connections`. */
export function workflowsWith(connections: Record<string, string[] | "read">) {
  return Promise.resolve(new Map([["workflow-1", { connections }]]));
}
