import { LoopErrorCode } from "@repo/api/src/types/loop";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { failLoopWithError } from "@/lib/loops/launch-failure-cleanup";
import { handleLoopEvent } from "@/lib/loops/loop-orchestrator";

/** Domain spans of the loop lifecycle: event ingest and failure helpers. */

const mocks = vi.hoisted(() => ({
  updateStatus: vi.fn(),
  addEvent: vi.fn(),
  findById: vi.fn(),
}));

vi.mock("@repo/database", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withDb: vi.fn(),
}));
vi.mock("@/app/loops/service", () => ({
  loopsService: {
    updateStatus: mocks.updateStatus,
    addEvent: mocks.addEvent,
    findById: mocks.findById,
  },
}));

const LOOP_ID = "0199a5f0-0000-7000-8000-0000000000a1";
const ORG_ID = "0199a5f0-0000-7000-8000-0000000000b1";
const recorder = installInMemorySpans();

afterAll(() => recorder.uninstall());

beforeEach(() => {
  vi.clearAllMocks();
  recorder.reset();
  mocks.updateStatus.mockResolvedValue({});
  mocks.addEvent.mockResolvedValue({});
  mocks.findById.mockResolvedValue(null);
});

function spanNamed(name: string) {
  return recorder.spans().find((span) => span.name === name);
}

describe("loop.event", () => {
  it("carries the loop id and event type for a started event", async () => {
    await handleLoopEvent(LOOP_ID, ORG_ID, {
      type: "started",
      loopId: LOOP_ID,
      timestamp: "2026-10-23T08:00:00.000Z",
    } as Parameters<typeof handleLoopEvent>[2]);

    const span = spanNamed("loop.event");
    expect(span?.attributes[AfAttribute.LoopId]).toBe(LOOP_ID);
    expect(span?.attributes[AfAttribute.OrgId]).toBe(ORG_ID);
    expect(span?.attributes["af.loop.event_type"]).toBe("started");
  });
});

describe("loop.fail", () => {
  it("marks the span as an error with the persisted message", async () => {
    await failLoopWithError(
      LOOP_ID,
      ORG_ID,
      LoopErrorCode.LaunchFailed,
      "The run failed while being prepared",
      "2026-10-23T08:00:00.000Z"
    );

    const span = spanNamed("loop.fail");
    expect(span?.attributes[AfAttribute.LoopId]).toBe(LOOP_ID);
    expect(span?.attributes["af.loop.fail_kind"]).toBe("with_error");
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Error);
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.status.message).toContain("failed while being prepared");
  });
});
