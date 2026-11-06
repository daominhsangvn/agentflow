import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowAgentMap } from "../use-workflow-agent-map";

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

describe("useWorkflowAgentMap", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
    mockApiClient.get.mockResolvedValue({ orchestrator: null, agents: [] });
  });

  it("reads the map from the workflow's agents path", async () => {
    const { result } = renderHook(() => useWorkflowAgentMap("w 1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith("/workflows/w%201/agents");
  });

  it("sends no request while disabled", () => {
    renderHook(() => useWorkflowAgentMap("w1", { enabled: false }), {
      wrapper,
    });

    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});
