import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLogRecordSink } from "../log-sink";
import { resetTraceContextProvider } from "../trace-context";
import { resetTelemetryFlushHook } from "../tracing/hooks";

afterEach(() => {
  resetLogRecordSink();
  resetTraceContextProvider();
  resetTelemetryFlushHook();
});

describe("process-wide registries across module copies", () => {
  it("shares the log sink", async () => {
    const first = await import("../log-sink");
    vi.resetModules();
    const second = await import("../log-sink");
    expect(second).not.toBe(first);

    const sink = vi.fn();
    first.setLogRecordSink(sink);
    expect(second.hasLogRecordSink()).toBe(true);
    second.emitLogRecord({
      level: "info",
      message: "m",
      attributes: {},
      timestampMs: 1,
    });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it("shares the trace-context provider", async () => {
    const first = await import("../trace-context");
    vi.resetModules();
    const second = await import("../trace-context");

    first.setTraceContextProvider(() => ({ traceId: "t", spanId: "s" }));
    expect(second.getTraceContext()).toEqual({ traceId: "t", spanId: "s" });
  });

  it("shares the flush hook", async () => {
    const first = await import("../tracing/hooks");
    vi.resetModules();
    const second = await import("../tracing/hooks");

    const hook = vi.fn(async () => undefined);
    first.setTelemetryFlushHook(hook);
    expect(second.isTelemetryActive()).toBe(true);
    await second.flushTelemetry();
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
