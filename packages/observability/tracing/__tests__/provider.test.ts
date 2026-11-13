import { context, trace } from "@opentelemetry/api";
import type { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEnvForTest } from "../../__tests__/test-helpers";
import { hasLogRecordSink } from "../../log-sink";
import {
  getTraceContext,
  resetTraceContextProvider,
} from "../../trace-context";
import { TelemetryDisabledReason } from "../config";
import { flushTelemetry, isTelemetryActive } from "../hooks";
import { initTelemetry, resetTelemetryForTest } from "../provider";

// ---------------------------------------------------------------------------
// tracing/provider.ts bootstrap. Exporters are replaced with in-memory ones so
// nothing touches the network.
// ---------------------------------------------------------------------------

const exporters = vi.hoisted(() => ({
  logs: undefined as unknown,
  spans: undefined as unknown,
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", async () => {
  const sdk = await import("@opentelemetry/sdk-logs");
  return {
    OTLPLogExporter: class extends sdk.InMemoryLogRecordExporter {
      constructor() {
        super();
        exporters.logs = this;
      }
    },
  };
});

vi.mock("@opentelemetry/exporter-trace-otlp-http", async () => {
  const sdk = await import("@opentelemetry/sdk-trace-node");
  return {
    OTLPTraceExporter: class extends sdk.InMemorySpanExporter {
      constructor() {
        super();
        exporters.spans = this;
      }
    },
  };
});

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: class {
    export(_metrics: unknown, done: (result: { code: number }) => void) {
      done({ code: 0 });
    }
    forceFlush() {
      return Promise.resolve();
    }
    shutdown() {
      return Promise.resolve();
    }
  },
}));

afterEach(async () => {
  await resetTelemetryForTest();
  resetTraceContextProvider();
  vi.unstubAllEnvs();
});

function clearEnv(): void {
  deleteEnvForTest(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SDK_DISABLED",
    "OTEL_SERVICE_NAME",
    "OTEL_TRACES_SAMPLER",
    "OTEL_TRACES_SAMPLER_ARG"
  );
}

function stubEnabledEnv(): void {
  clearEnv();
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");
}

describe("initTelemetry", () => {
  it("reports an enabled config and installs the seams", () => {
    stubEnabledEnv();

    const result = initTelemetry();

    expect(result.enabled).toBe(true);
    expect(isTelemetryActive()).toBe(true);
    expect(hasLogRecordSink()).toBe(true);
    expect(getTraceContext()).toBeUndefined();
  });

  it("installs nothing without an endpoint", () => {
    clearEnv();

    expect(initTelemetry()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.MissingEndpoint,
    });
    expect(isTelemetryActive()).toBe(false);
    expect(hasLogRecordSink()).toBe(false);
  });

  it("honours OTEL_SDK_DISABLED", () => {
    stubEnabledEnv();
    vi.stubEnv("OTEL_SDK_DISABLED", "true");

    expect(initTelemetry()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.ExplicitlyDisabled,
    });
    expect(isTelemetryActive()).toBe(false);
  });

  it("returns the first outcome even after the env changes", () => {
    clearEnv();
    const first = initTelemetry();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");

    expect(initTelemetry()).toEqual(first);
    expect(isTelemetryActive()).toBe(false);
  });

  it("does not stamp trace ids for a sampled-out span", () => {
    stubEnabledEnv();
    initTelemetry();
    const sampledOut = trace.wrapSpanContext({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 0,
    });

    const stamped = context.with(
      trace.setSpan(context.active(), sampledOut),
      () => getTraceContext()
    );

    expect(stamped).toBeUndefined();
  });

  it("exports log records carrying the active span's trace id", async () => {
    stubEnabledEnv();
    initTelemetry();
    const { log } = await import("../../log");

    let spanTraceId = "";
    trace.getTracer("test").startActiveSpan("work", (span) => {
      spanTraceId = span.spanContext().traceId;
      log.info("inside span");
      span.end();
    });
    await flushTelemetry();

    const records = (
      exporters.logs as InMemoryLogRecordExporter
    ).getFinishedLogRecords();
    const match = records.find((r) => r.body === "inside span");
    expect(spanTraceId).not.toBe("");
    expect(match?.spanContext?.traceId).toBe(spanTraceId);
    expect(exporters.spans as InMemorySpanExporter).toBeDefined();
  });
});

describe("flushTelemetry", () => {
  it("resolves when never initialised", async () => {
    await expect(flushTelemetry()).resolves.toBeUndefined();
  });
});
