"use client";

import {
  type AgentDetail,
  type AgentFleetEntry,
  type AgentFleetResponse,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import { ApiError } from "@repo/app/shared/api/api-error";
import { useApiClient } from "@repo/app/shared/api/use-api-client";
import { useQuery } from "@tanstack/react-query";

/** Org-wide agents (compute targets): the fleet list and one agent's detail. */

const FLEET_REFETCH_INTERVAL_MS = 30_000;
const DETAIL_STALE_TIME_MS = 30_000;

export const agentFleetKeys = {
  all: ["agent-fleet"] as const,
  detail: (id: string) => [...agentFleetKeys.all, "detail", id] as const,
};

export type AgentFleetSummary = {
  online: number;
  offline: number;
  automatic: number;
  personal: number;
  versionMismatches: number;
};

export function useAgentFleet() {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: agentFleetKeys.all,
    queryFn: () => apiClient.get<AgentFleetResponse>("/compute-targets/fleet"),
    // Poll only while the last read succeeded.
    refetchInterval: (query) =>
      query.state.status === "error" ? false : FLEET_REFETCH_INTERVAL_MS,
  });
}

export function useAgentDetail(agentId: string) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: agentFleetKeys.detail(agentId),
    queryFn: () =>
      apiClient.get<AgentDetail>(
        `/compute-targets/${encodeURIComponent(agentId)}/agent-detail`
      ),
    enabled: !!agentId,
    staleTime: DETAIL_STALE_TIME_MS,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.isNotFound()) && failureCount < 3,
  });
}

export function summarizeAgentFleet(
  agents: readonly AgentFleetEntry[]
): AgentFleetSummary {
  const summary: AgentFleetSummary = {
    online: 0,
    offline: 0,
    automatic: 0,
    personal: 0,
    versionMismatches: 0,
  };
  for (const agent of agents) {
    if (agent.isOnline) {
      summary.online += 1;
    } else {
      summary.offline += 1;
    }
    if (agent.kind === AgentKind.Personal) {
      summary.personal += 1;
    } else {
      summary.automatic += 1;
    }
    if (agent.claudeCode.status === ClaudeCodeVersionStatus.Mismatch) {
      summary.versionMismatches += 1;
    }
  }
  return summary;
}
