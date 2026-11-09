"use client";

import type { WorkflowAgentMap } from "@repo/api/src/types/orchestrator";
import { useApiClient } from "@repo/app/shared/api/use-api-client";
import { useQuery } from "@tanstack/react-query";
import { orchestratorCaseKeys } from "./use-orchestrator-cases";

const AGENT_MAP_POLL_MS = 30_000;

/** The orchestrator and the project agents of a workflow, with their state. */
export function useWorkflowAgentMap(
  workflowId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: orchestratorCaseKeys.agentMap(workflowId),
    queryFn: () =>
      apiClient.get<WorkflowAgentMap>(
        `/workflows/${encodeURIComponent(workflowId)}/agents`
      ),
    enabled: enabled && !!workflowId,
    refetchInterval: AGENT_MAP_POLL_MS,
  });
}
