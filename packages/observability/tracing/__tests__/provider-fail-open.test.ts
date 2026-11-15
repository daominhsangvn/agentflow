import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEnvForTest } from "../../__tests__/test-helpers";

// ---------------------------------------------------------------------------
// tracing/provider.ts: a failing SDK bootstrap degrades to "untelemetered",
// never to a failed cold start. The SDK mock is module-scoped, hence its own
// file.
// ---------------------------------------------------------------------------

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {
      throw new Error("simulated SDK bootstrap failure");
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

afterEach(async () => {
  const { resetTelemetryForTest } = await import("../provider");
  await resetTelemetryForTest();
  vi.unstubAllEnvs();
});

function stubEnabledEnv(): void {
  deleteEnvForTest(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SDK_DISABLED",
    "OTEL_TRACES_SAMPLER",
    "OTEL_TRACES_SAMPLER_ARG"
  );
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");
}

describe("initTelemetry when the SDK bootstrap throws", () => {
  it("does not throw and reports InitFailed", async () => {
    stubEnabledEnv();
    const { initTelemetry } = await import("../provider");
    const { TelemetryDisabledReason } = await import("../config");

    expect(() => initTelemetry()).not.toThrow();
    expect(initTelemetry()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.InitFailed,
    });
  });

  it("leaves every seam unset", async () => {
    stubEnabledEnv();
    const { initTelemetry } = await import("../provider");
    const { getTraceContext } = await import("../../trace-context");
    const { hasLogRecordSink } = await import("../../log-sink");
    const { flushTelemetry, isTelemetryActive } = await import("../hooks");

    initTelemetry();

    expect(getTraceContext()).toBeUndefined();
    expect(hasLogRecordSink()).toBe(false);
    expect(isTelemetryActive()).toBe(false);
    await expect(flushTelemetry()).resolves.toBeUndefined();
  });
});
