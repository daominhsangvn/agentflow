import { LoopCommand } from "@repo/api/src/types/loop";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { createCommand } = vi.hoisted(() => ({ createCommand: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop-command-store", () => ({
  desktopCommandStore: { createCommand, markCommandExpired: vi.fn() },
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { findById: vi.fn().mockResolvedValue(null) },
}));
vi.mock("@/app/compute-targets/model-provider-service", () => ({
  resolveComputeTargetClaudeRuntime: vi
    .fn()
    .mockResolvedValue({ claudeCodeVersion: "1.0.0" }),
}));

import { relayEventBus } from "@/lib/relay-event-bus";
import {
  DispatchError,
  LoopDispatchKind,
  launchLoopOnDesktop,
  stopDesktopLoop,
} from "../loop-desktop";

const TARGET_ID = "ct-spans";
const COMMAND_ID = "cmd-spans-1";
const TRACEPARENT_PATTERN = /^00-([\da-f]{32})-/;

const launchOpts = {
  loopId: "loop-spans",
  organizationId: "org-1",
  command: LoopCommand.Execute,
  computeTargetId: TARGET_ID,
  agentFlowAuthToken: "tok",
  apiBaseUrl: "https://api.example.com",
  contextPack: { command: LoopCommand.Execute, artifacts: [] },
};

describe("loop.dispatch span", () => {
  const memory = installInMemorySpans();

  beforeEach(() => {
    memory.reset();
    createCommand.mockResolvedValue({ command: { commandId: COMMAND_ID } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    memory.uninstall();
  });

  it("stamps the dispatch span's traceparent on the published operation", async () => {
    const received: { traceparent?: string }[] = [];
    const unsubscribe = relayEventBus.subscribeOperations(TARGET_ID, (op) => {
      received.push(op);
    });

    await expect(stopDesktopLoop("loop-spans", TARGET_ID)).resolves.toBe(
      undefined
    );
    unsubscribe();

    const span = memory.spans().find((s) => s.name === "loop.dispatch");
    expect(span?.attributes[AfAttribute.LoopId]).toBe("loop-spans");
    expect(span?.attributes[AfAttribute.CommandId]).toBe(COMMAND_ID);
    expect(span?.attributes["af.loop.dispatch_kind"]).toBe(
      LoopDispatchKind.Stop
    );
    const traceId = TRACEPARENT_PATTERN.exec(
      received[0]?.traceparent ?? ""
    )?.[1];
    expect(traceId).toBe(span?.traceId);
  });

  it("marks target_offline when no runner is subscribed", async () => {
    vi.useFakeTimers();
    const outcome = launchLoopOnDesktop(launchOpts).catch((error) => error);
    await vi.runAllTimersAsync();

    expect(await outcome).toBeInstanceOf(DispatchError);
    const span = memory.spans().find((s) => s.name === "loop.dispatch");
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Error);
    expect(span?.attributes[AfAttribute.ErrorReason]).toBe("target_offline");
  });
});
