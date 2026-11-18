import { log } from "@repo/observability/log";
import {
  type InMemorySpans,
  installInMemorySpans,
} from "@repo/observability/testing/in-memory-spans";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRegister,
  mockListNonTerminal,
  mockSubscribeOperations,
  mockSubscribeTargetConnection,
  mockClearOperationBacklog,
  mockHeartbeat,
  mockIsDirectDesktopAuthSigningEligible,
} = vi.hoisted(() => ({
  mockRegister: vi.fn(),
  mockListNonTerminal: vi.fn(),
  mockSubscribeOperations: vi.fn(),
  mockSubscribeTargetConnection: vi.fn(),
  mockClearOperationBacklog: vi.fn(),
  mockHeartbeat: vi.fn(),
  mockIsDirectDesktopAuthSigningEligible: vi.fn(),
}));

const { mockCheckPersonalAgentProject } = vi.hoisted(() => ({
  mockCheckPersonalAgentProject: vi.fn(),
}));

vi.mock("../../app/compute-targets/personal-agent-project", () => ({
  checkPersonalAgentProject: mockCheckPersonalAgentProject,
}));

vi.mock("../desktop-command-store", () => ({
  desktopCommandStore: {
    listNonTerminalDispatchCommands: mockListNonTerminal,
    ingestCommandEvent: mockIngestCommandEvent,
    getCommandById: vi.fn(),
  },
}));

const { mockIngestCommandEvent } = vi.hoisted(() => ({
  mockIngestCommandEvent: vi.fn(),
}));

const { mockSetOnlineState } = vi.hoisted(() => ({
  mockSetOnlineState: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../app/compute-targets/service", () => ({
  computeTargetsService: {
    register: mockRegister,
    updateOwned: vi.fn(),
    setOnlineState: mockSetOnlineState,
    heartbeat: mockHeartbeat,
  },
  isComputeTargetGatewayConflictResult: (result: {
    ok: boolean;
    error?: string;
  }) => !result.ok && result.error === "gateway_conflict",
  isComputeTargetMachineNameInUseResult: (result: {
    ok: boolean;
    error?: string;
  }) => !result.ok && result.error === "machine_name_in_use",
}));

vi.mock("../relay-event-bus", () => ({
  relayEventBus: {
    subscribeOperations: mockSubscribeOperations,
    subscribeTargetConnection: mockSubscribeTargetConnection,
    clearOperationBacklog: mockClearOperationBacklog,
  },
}));

vi.mock("../../app/api-keys/service", () => ({
  apiKeysService: {
    verifyKeyWithMetadata: vi.fn(),
    touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../app/users/service", () => ({
  usersService: {
    findById: vi.fn(),
  },
}));

vi.mock("../auth/desktop-managed-pop", () => ({
  getDesktopManagedPopRequestFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock("../compute-target-signing-eligibility", () => ({
  CommandSigningEligibilityStatus: {
    Eligible: "eligible",
    Ineligible: "ineligible",
    Unknown: "unknown",
  },
  isDirectDesktopAuthSigningEligible: mockIsDirectDesktopAuthSigningEligible,
}));

vi.mock("../desktop-agent-sessions-handler", () => ({
  handleDesktopAgentSessionsEvent: vi
    .fn()
    .mockResolvedValue({ accepted: true }),
}));

vi.mock("../desktop-analytics-handler", () => ({
  handleDesktopAnalyticsEvent: vi.fn().mockResolvedValue({ accepted: true }),
}));

vi.mock("../desktop-analytics-schema", () => ({
  DESKTOP_ANALYTICS_SOCKET_EVENT: "desktop.analytics",
  DesktopAnalyticsAckReason: { ValidationFailed: "validation_failed" },
}));

vi.mock("../desktop-command-ack-handler", () => ({
  acknowledgeDesktopCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../desktop-relay-event-bridge", () => ({
  publishLegacyRelayEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../desktop-telemetry-handler", () => ({
  handleTelemetryEvent: vi.fn().mockReturnValue({ ok: true, emits: [] }),
}));

vi.mock("../desktop-gateway-reconnect", () => ({
  partitionPendingCommandsForReconnect: vi
    .fn()
    .mockReturnValue({ emit: [], skipped: [] }),
}));

vi.mock("@repo/observability/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@repo/analytics/node", () => ({
  nodeAnalytics: {
    capture: vi.fn(),
  },
}));

vi.mock("@repo/observability/telemetry/context", () => ({
  buildTelemetryTraceContext: vi.fn().mockReturnValue({}),
}));

import { handleSocketConnection } from "../desktop-gateway-socket-server";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;
const TARGET_ID = "target-spans-1";

type Handler = (payload?: unknown) => void;

function makeSocket() {
  const handlers = new Map<string, Handler>();
  return {
    id: "socket-spans-1",
    connected: true,
    emit: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    handlers,
    data: {
      authContext: {
        organizationId: "org-spans",
        userId: "user-spans",
        clerkUserId: "clerk-spans",
        apiKeySource: "DESKTOP_MANAGED",
        apiKeyGatewayId: "gateway-spans",
        apiKeyBoundPublicKey: "public-key-spans",
      },
    },
  };
}

async function connectedSocket() {
  const socket = makeSocket();
  handleSocketConnection(socket as never);
  socket.handlers.get("desktop.hello")?.({
    machineName: "test-machine",
    platform: "linux",
    pluginVersion: "1.2.3",
    supportedOperations: [],
    maxInFlightCommands: 4,
    gatewayId: "gateway-spans",
  });
  await vi.waitFor(() => {
    if (
      !socket.emit.mock.calls.some(([event]) => event === "desktop.hello.ack")
    ) {
      throw new Error("hello ack not emitted yet");
    }
  });
  return socket;
}

describe("desktop gateway socket spans", () => {
  let spans: InMemorySpans;

  beforeEach(() => {
    vi.clearAllMocks();
    spans = installInMemorySpans();
    mockCheckPersonalAgentProject.mockResolvedValue({ ok: true, value: null });
    mockRegister.mockResolvedValue({ ok: true, value: { id: TARGET_ID } });
    mockListNonTerminal.mockResolvedValue([]);
    mockSubscribeOperations.mockReturnValue(() => {});
    mockSubscribeTargetConnection.mockReturnValue(() => {});
    mockHeartbeat.mockResolvedValue(undefined);
    mockSetOnlineState.mockResolvedValue(true);
    mockIsDirectDesktopAuthSigningEligible.mockResolvedValue({
      status: "ineligible",
      reason: "missing_gateway",
    });
    mockIngestCommandEvent.mockResolvedValue({
      accepted: true,
      duplicate: true,
      sequence: 1,
    });
  });

  afterEach(() => {
    spans.uninstall();
  });

  function emitEvent(
    socket: Awaited<ReturnType<typeof connectedSocket>>,
    extra: Record<string, unknown>
  ) {
    socket.handlers.get("desktop.command.event")?.({
      commandId: "cmd-1",
      sequence: 1,
      eventType: "status",
      data: null,
      ...extra,
    });
  }

  it("continues the runner trace on command events", async () => {
    const socket = await connectedSocket();
    emitEvent(socket, { traceparent: TRACEPARENT });

    await vi.waitFor(() =>
      expect(
        spans.spans().some((span) => span.name === "gateway.command_event")
      ).toBe(true)
    );
    const span = spans
      .spans()
      .find((candidate) => candidate.name === "gateway.command_event");
    expect(span?.traceId).toBe(TRACE_ID);
    expect(span?.attributes["af.command_id"]).toBe("cmd-1");
  });

  it("starts a new trace when the event has no traceparent", async () => {
    const socket = await connectedSocket();
    emitEvent(socket, {});

    await vi.waitFor(() =>
      expect(
        spans.spans().some((span) => span.name === "gateway.command_event")
      ).toBe(true)
    );
    const span = spans
      .spans()
      .find((candidate) => candidate.name === "gateway.command_event");
    expect(span?.traceId).not.toBe(TRACE_ID);
  });

  it("marks the target offline once when the last socket disconnects", async () => {
    const socket = await connectedSocket();
    socket.handlers.get("disconnect")?.();

    await vi.waitFor(() =>
      expect(mockSetOnlineState).toHaveBeenCalledWith(
        TARGET_ID,
        expect.anything(),
        expect.anything(),
        false
      )
    );
    // The offline log comes from setOnlineState, not from the socket server.
    expect(log.warn).not.toHaveBeenCalledWith(
      "compute_target.offline",
      expect.anything()
    );
  });
});
