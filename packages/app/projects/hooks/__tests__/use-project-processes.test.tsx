import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectProcesses } from "../use-project-process";

const mockApiClient = {
  get: vi.fn(),
};

vi.mock("../../../shared/api/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useProjectProcesses", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
  });

  it("includes loaded projects, with null for a project without a process", async () => {
    const definition = { steps: [] };
    mockApiClient.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/projects/p1/process"
          ? { current: { definition } }
          : { current: null }
      )
    );

    const { result } = renderHook(() => useProjectProcesses(["p1", "p2"]), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));
    expect(result.current.p1).toEqual(definition);
    expect(result.current.p2).toBeNull();
  });

  it("leaves out failed and still-loading projects", async () => {
    mockApiClient.get.mockImplementation((path: string) => {
      if (path === "/projects/ok/process") {
        return Promise.resolve({ current: null });
      }
      if (path === "/projects/bad/process") {
        return Promise.reject(new Error("boom"));
      }
      return new Promise(() => undefined);
    });

    const { result } = renderHook(
      () => useProjectProcesses(["ok", "bad", "slow"]),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect("ok" in result.current).toBe(true));
    await waitFor(() => expect(mockApiClient.get).toHaveBeenCalledTimes(3));
    expect(Object.keys(result.current)).toEqual(["ok"]);
  });

  it("leaves out every project while disabled", () => {
    const { result } = renderHook(
      () => useProjectProcesses(["p1"], { enabled: false }),
      { wrapper: createWrapper() }
    );

    expect(result.current).toEqual({});
    expect(mockApiClient.get).not.toHaveBeenCalled();
  });
});
