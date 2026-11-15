import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ProtocolMetric } from "../telemetry/metrics";
import {
  ConnectionState,
  emitProtocolMetric,
  emitTelemetryMetric,
} from "../telemetry/metrics";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ProtocolMetric type-level cardinality
// ---------------------------------------------------------------------------

describe("ProtocolMetric type-level cardinality", () => {
  it("compiles", () => {
    // Positive: valid connection_state_count metric is assignable to ProtocolMetric
    expectTypeOf({
      metric: "connection_state_count" as const,
      state: ConnectionState.Online,
      count: 1 as const,
      computeTargetId: "x",
      timestamp: "t",
    }).toMatchTypeOf<ProtocolMetric>();

    // Negative: state must be a ConnectionState value, not an arbitrary string.
    const _a: ProtocolMetric = {
      metric: "connection_state_count",
      // @ts-expect-error — "invalid" is not assignable to ConnectionState
      state: "invalid",
      count: 1,
    };

    // Negative: connection_state_count requires the `state` field.
    // @ts-expect-error — state is required on the connection_state_count arm
    const _b: ProtocolMetric = {
      metric: "connection_state_count",
      count: 1,
    };

    // Negative: connection_churn_rate (ProtocolBaseMetric) does not accept `state`.
    const _c: ProtocolMetric = {
      metric: "connection_churn_rate",
      // @ts-expect-error — state is not a valid field on non-connection_state_count arms
      state: ConnectionState.Online,
    };
  });
});

// ---------------------------------------------------------------------------
// OTel Meter recording
// ---------------------------------------------------------------------------

describe("emitTelemetryMetric — OTel Meter", () => {
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
      return exporter
        .getMetrics()
        .flatMap((rm) => rm.scopeMetrics)
        .flatMap((sm) => sm.metrics);
    };
    return { provider, collect };
  }

  let current: ReturnType<typeof setup> | undefined;

  afterEach(async () => {
    metrics.disable();
    await current?.provider.shutdown();
    current = undefined;
  });

  it("sums count into a counter with attributes", async () => {
    current = setup();
    for (let i = 0; i < 2; i++) {
      emitTelemetryMetric({
        metric: "connection_state_count",
        state: "online",
        count: 1,
        gatewaySessionId: "sess_secret",
        commandId: "cmd_1",
      });
    }
    const all = await current.collect();
    const m = all.find((x) => x.descriptor.name === "connection_state_count");
    expect(m?.dataPoints).toHaveLength(1);
    const dp = m?.dataPoints[0];
    expect(dp?.value).toBe(2);
    expect(dp?.attributes).toEqual({ state: "online" });
  });

  it("records a protocol metric with its state attribute", async () => {
    current = setup();
    emitProtocolMetric({
      metric: "connection_state_count",
      state: ConnectionState.Online,
      count: 1,
      computeTargetId: "ct_test",
      gatewaySessionId: "sess_test",
      timestamp: "2026-04-20T00:00:00.000Z",
    });
    const all = await current.collect();
    const m = all.find((x) => x.descriptor.name === "connection_state_count");
    expect(m?.dataPoints[0]?.attributes).toEqual(
      expect.objectContaining({ state: ConnectionState.Online })
    );
  });

  it("records value as a gauge and drops excluded keys", async () => {
    current = setup();
    emitTelemetryMetric({
      metric: "db_pool_in_use",
      value: 3,
      origin: "api",
      poolMax: 10,
      inUse: 3,
      timestamp: "t",
    });
    emitTelemetryMetric({ metric: "db_pool_in_use", value: 5, origin: "api" });
    const all = await current.collect();
    const m = all.find((x) => x.descriptor.name === "db_pool_in_use");
    const dp = m?.dataPoints[0];
    expect(dp?.value).toBe(5);
    expect(dp?.attributes).toEqual({ origin: "api" });
  });

  it("redacts sensitive string field values in metric attributes", async () => {
    current = setup();
    emitTelemetryMetric({
      metric: "redaction_probe",
      count: 1,
      reason: `token ghp_${"b".repeat(36)} for a@b.com`,
    });
    const all = await current.collect();
    const m = all.find((x) => x.descriptor.name === "redaction_probe");
    const reason = String(m?.dataPoints[0]?.attributes.reason);
    expect(reason).toContain("[redacted]");
    expect(reason).not.toContain("ghp_");
    expect(reason).not.toContain("a@b.com");
  });

  it("does not throw without a provider", () => {
    expect(() =>
      emitTelemetryMetric({ metric: "x_metric", count: 1 })
    ).not.toThrow();
  });
});
