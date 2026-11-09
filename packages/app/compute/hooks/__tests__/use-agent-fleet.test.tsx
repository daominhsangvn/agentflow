import {
  type AgentFleetEntry,
  AgentKind,
  ClaudeCodeVersionStatus,
} from "@repo/api/src/types/agent-fleet";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeAgentFleet, useAgentDetail } from "../use-agent-fleet";

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

function agent(overrides: {
  isOnline: boolean;
  kind: AgentKind;
  status: ClaudeCodeVersionStatus;
}): AgentFleetEntry {
  return {
    id: "a",
    machineName: "m",
    displayName: null,
    kind: overrides.kind,
    ownerName: null,
    isSharedWithOrg: false,
    isOnline: overrides.isOnline,
    lastSeen: "2026-10-30T00:00:00.000Z",
    health: null,
    claudeCode: { reported: null, pinned: "latest", status: overrides.status },
    projects: [],
    enabledWorkflowCount: 0,
  };
}

describe("summarizeAgentFleet", () => {
  it("counts online, kinds and version mismatches", () => {
    const summary = summarizeAgentFleet([
      agent({
        isOnline: true,
        kind: AgentKind.Automatic,
        status: ClaudeCodeVersionStatus.Match,
      }),
      agent({
        isOnline: false,
        kind: AgentKind.Personal,
        status: ClaudeCodeVersionStatus.Mismatch,
      }),
      agent({
        isOnline: true,
        kind: AgentKind.Automatic,
        status: ClaudeCodeVersionStatus.Mismatch,
      }),
    ]);

    expect(summary).toEqual({
      online: 2,
      offline: 1,
      automatic: 2,
      personal: 1,
      versionMismatches: 2,
    });
  });

  it("is all zero for an empty fleet", () => {
    expect(summarizeAgentFleet([])).toEqual({
      online: 0,
      offline: 0,
      automatic: 0,
      personal: 0,
      versionMismatches: 0,
    });
  });
});

describe("useAgentDetail", () => {
  beforeEach(() => {
    mockApiClient.get.mockReset();
    mockApiClient.get.mockResolvedValue({});
  });

  it("reads the agent-detail endpoint", async () => {
    const { result } = renderHook(() => useAgentDetail("agent-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiClient.get).toHaveBeenCalledWith(
      "/compute-targets/agent-1/agent-detail"
    );
  });
});
