"use client";

import {
  type OrgAttentionStats,
  type OrgCaseStats,
  type OrgProjectStats,
  type OrgSessionStats,
  OrgStatsPath,
  type OrgUsageStats,
  type OrgWorkflowStats,
} from "@repo/api/src/types/org-stats";
import { useApiClient } from "@repo/app/shared/api/use-api-client";
import { useQuery } from "@tanstack/react-query";

/**
 * Home statistics: one query per widget so each has its own loading, error and
 * empty state (no widget waits for another).
 */

const ORG_STATS_STALE_TIME_MS = 60_000;

export const orgStatsKeys = {
  all: ["org-stats"] as const,
  widget: (path: OrgStatsPath) => [...orgStatsKeys.all, path] as const,
};

export function useOrgProjectStats() {
  return useOrgStats<OrgProjectStats>(OrgStatsPath.Projects);
}

export function useOrgWorkflowStats() {
  return useOrgStats<OrgWorkflowStats>(OrgStatsPath.Workflows);
}

export function useOrgCaseStats() {
  return useOrgStats<OrgCaseStats>(OrgStatsPath.Cases);
}

export function useOrgSessionStats() {
  return useOrgStats<OrgSessionStats>(OrgStatsPath.Sessions);
}

export function useOrgUsageStats() {
  return useOrgStats<OrgUsageStats>(OrgStatsPath.Usage);
}

export function useOrgAttentionStats() {
  return useOrgStats<OrgAttentionStats>(OrgStatsPath.Attention);
}

function useOrgStats<TStats>(path: OrgStatsPath) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: orgStatsKeys.widget(path),
    queryFn: () => apiClient.get<TStats>(path),
    staleTime: ORG_STATS_STALE_TIME_MS,
  });
}
