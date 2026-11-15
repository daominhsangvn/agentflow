import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../log";
import { SHORT_HASH_PATTERN } from "../redact-correlation";
import { buildTelemetryTraceContext } from "../telemetry/context";
import { emitConnectionStateEvent } from "../telemetry/emitter";
import { ConnectionState, emitProtocolMetric } from "../telemetry/metrics";
import { Origin } from "../telemetry/origin";
import { TelemetryCategory } from "../telemetry/schema";

const RAW_GATEWAY_SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

afterEach(() => {
  vi.restoreAllMocks();
});

// The raw gatewaySessionId session token must never reach a telemetry sink.

describe("emitProtocolMetric — gatewaySessionId redaction", () => {
  function setup() {
    const exporter = new InMemoryMetricExporter(
      AggregationTemporality.CUMULATIVE
    );
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 3_600_000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    const collect = async () => {
      await reader.forceFlush();
      return exporter.getMetrics();
    };
    return { provider, collect };
  }

  let current: ReturnType<typeof setup> | undefined;

  afterEach(async () => {
    metrics.disable();
    await current?.provider.shutdown();
    current = undefined;
  });

  it("never records the raw gatewaySessionId (ack_latency)", async () => {
    current = setup();

    emitProtocolMetric({
      metric: "ack_latency",
      origin: Origin.Api,
      value: 12,
      computeTargetId: "ct-1",
      gatewaySessionId: RAW_GATEWAY_SESSION_ID,
      timestamp: "2026-06-29T00:00:00.000Z",
    });

    const exported = JSON.stringify(await current.collect());
    expect(exported).toContain("ack_latency");
    expect(exported).not.toContain(RAW_GATEWAY_SESSION_ID);
  });

  it("never records the raw gatewaySessionId (connection_state_count)", async () => {
    current = setup();

    emitProtocolMetric({
      metric: "connection_state_count",
      state: ConnectionState.Online,
      count: 1,
      computeTargetId: "ct-1",
      gatewaySessionId: RAW_GATEWAY_SESSION_ID,
      timestamp: "2026-06-29T00:00:00.000Z",
    });

    const exported = JSON.stringify(await current.collect());
    expect(exported).toContain("connection_state_count");
    expect(exported).not.toContain(RAW_GATEWAY_SESSION_ID);
  });
});

describe("emitConnectionStateEvent — gatewaySessionId redaction", () => {
  it("hashes gatewaySessionId in the emitted telemetry trace", () => {
    const spy = vi.spyOn(log, "info").mockImplementation(() => {});

    emitConnectionStateEvent(
      TelemetryCategory.ConnectionRegistered,
      buildTelemetryTraceContext({
        computeTargetId: "ct-1",
        gatewaySessionId: RAW_GATEWAY_SESSION_ID,
      })
    );

    const logged = spy.mock.calls.at(-1)?.[0] as string;
    expect(logged).toBeDefined();
    const parsed = JSON.parse(logged) as {
      trace?: { gatewaySessionId?: string };
    };
    expect(parsed.trace?.gatewaySessionId).toEqual(
      expect.stringMatching(SHORT_HASH_PATTERN)
    );
    expect(parsed.trace?.gatewaySessionId).not.toBe(RAW_GATEWAY_SESSION_ID);
    expect(logged).not.toContain(RAW_GATEWAY_SESSION_ID);
  });
});
