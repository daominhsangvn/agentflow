import { OrgStatsPath } from "@repo/api/src/types/org-stats";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useOrgAttentionStats,
  useOrgCaseStats,
  useOrgProjectStats,
  useOrgSessionStats,
  useOrgUsageStats,
  useOrgWorkflowStats,
} from "../use-org-stats";

const mockApiClient = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../../shared/api/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("org stats hooks", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
    mockApiClient.get.mockResolvedValue({});
  });

  it.each([
    ["projects", useOrgProjectStats, OrgStatsPath.Projects],
    ["workflows", useOrgWorkflowStats, OrgStatsPath.Workflows],
    ["cases", useOrgCaseStats, OrgStatsPath.Cases],
    ["sessions", useOrgSessionStats, OrgStatsPath.Sessions],
    ["usage", useOrgUsageStats, OrgStatsPath.Usage],
    ["attention", useOrgAttentionStats, OrgStatsPath.Attention],
  ])("%s calls its own path", async (_name, hook, path) => {
    const { result } = renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledTimes(1);
    expect(mockApiClient.get).toHaveBeenCalledWith(path);
  });
});
