import { WORKFLOW_BUILDER_STATUS_PATH } from "@repo/api/src/types/workflow-builder";
import {
  createTestQueryClient,
  createWrapperWithClient,
} from "@repo/app/shared/test-utils";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowBuilderStatus } from "../use-workflow-builder-status";

const mockApiClient = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@repo/app/shared/api/use-api-client", () => ({
  useApiClient: () => mockApiClient,
}));

describe("useWorkflowBuilderStatus", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
  });

  it("does not request while disabled", () => {
    const wrapper = createWrapperWithClient(createTestQueryClient());
    renderHook(() => useWorkflowBuilderStatus({ enabled: false }), {
      wrapper,
    });

    expect(mockApiClient.get).not.toHaveBeenCalled();
  });

  it("gets the status path when enabled", async () => {
    mockApiClient.get.mockResolvedValue({ enabled: true });
    const wrapper = createWrapperWithClient(createTestQueryClient());
    const { result } = renderHook(
      () => useWorkflowBuilderStatus({ enabled: true }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApiClient.get).toHaveBeenCalledWith(
      WORKFLOW_BUILDER_STATUS_PATH
    );
    expect(result.current.data).toEqual({ enabled: true });
  });
});
