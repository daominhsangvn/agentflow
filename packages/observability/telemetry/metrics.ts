import {
  type Counter,
  type Gauge,
  type Meter,
  metrics,
} from "@opentelemetry/api";
import { isSensitiveKey, redactSensitiveText } from "../redact";
import { redactGatewaySessionId } from "../redact-correlation";
import type { FilterToken } from "./filter-tokens";
import type { Origin } from "./origin";

// ---------------------------------------------------------------------------
// QueueMetric — executor/queue health metrics
// ---------------------------------------------------------------------------

export type QueueMetric = {
  metric:
    | "queued_command_count"
    | "in_flight_command_count"
    | "retry_attempts"
    | "replay_frequency"
    | "executor_saturation"
    | "dropped_expired_work_items"
    | "command_state_transition";
  origin: Origin;
  count?: number;
  value?: number;
  computeTargetId?: string;
  timestamp?: string;
  fromStatus?: string;
  toStatus?: string;
  commandId?: string;
  filterToken?: FilterToken;
  reason?: string;
};

// ---------------------------------------------------------------------------
// ConnectionState — connection health state values
// ---------------------------------------------------------------------------

export const ConnectionState = {
  Online: "online",
  Degraded: "degraded",
  Disconnected: "disconnected",
} as const;
export type ConnectionState =
  (typeof ConnectionState)[keyof typeof ConnectionState];

// ---------------------------------------------------------------------------
// ProtocolMetric — connection/protocol health metrics
// ---------------------------------------------------------------------------

/** Emitted with count: 1 per state transition. Aggregate via sum(count) by {state} for transition-rate view; NOT a live gauge of currently-connected workers. The literal `count: 1` is the enforced invariant — any other numeric count on this metric is a bug. */
type ConnectionStateCountMetric = {
  metric: "connection_state_count";
  state: ConnectionState;
  count: 1;
  computeTargetId?: string;
  gatewaySessionId?: string;
  timestamp?: string;
};

type ProtocolBaseMetric = {
  metric:
    | "ack_latency"
    | "terminal_event_latency"
    | "heartbeat_freshness"
    | "presence_received_latency"
    | "reconnect_frequency"
    | "event_ordering_gaps"
    | "command_ack_lifecycle_context_omitted"
    | "connection_churn_rate"
    | "replay_window_usage";
  origin: Origin;
  value?: number;
  count?: number;
  computeTargetId?: string;
  gatewaySessionId?: string;
  timestamp?: string;
};

export type ProtocolMetric = ConnectionStateCountMetric | ProtocolBaseMetric;

// ---------------------------------------------------------------------------
// DbPoolMetric — pg connection-pool health metrics (FEA-3300)
// ---------------------------------------------------------------------------

/**
 * Structurally mirrors `PoolTelemetrySample` in `@repo/database`. The two are
 * intentionally not a shared type: `@repo/database` must stay free of any
 * `@repo/observability` import (apps/mcp packages it through a narrow Docker
 * context), so the pool emits through an injected sink and `apps/api` adapts
 * the sample to this shape.
 *
 * The duplication cannot drift silently: the sink adapter in
 * `apps/api/instrumentation.ts` only type-checks while a `PoolTelemetrySample`
 * can be widened into a `DbPoolMetric`, so adding a metric on one side and not
 * the other is a compile error at the wiring site, not a runtime surprise.
 *
 * `origin` is **required and must be set by the caller**, matching
 * `QueueMetric`/`ProtocolMetric`. It is not safe to rely on `buildEntry()` here:
 * that only enriches the agentless HTTP intake payload, while `writeConsole()`
 * emits `{...meta, message, level}` to stdout — so on the Vercel Log Drain path
 * `@origin` comes **solely from this payload**. Omitting it would make
 * `db_pool_*` the one metric family invisible to an `@origin` predicate on that
 * path.
 *
 * `poolMax`/`waitingCount`/`inUse`/`idle`/`total` ride as log attributes for
 * diagnosis; they are deliberately NOT metric tags.
 */
export type DbPoolMetric = {
  metric:
    | "db_pool_acquire_wait"
    | "db_pool_acquire_timeout"
    | "db_pool_checkout_duration"
    | "db_pool_wait_queue_depth"
    | "db_pool_in_use"
    | "db_pool_idle"
    | "db_pool_total";
  origin: Origin;
  /** Gauge/measurement (ms for durations). Mutually exclusive with `count`. */
  value?: number;
  /** Additive counter; always 1. Mutually exclusive with `value`. */
  count?: number;
  poolMax: number;
  waitingCount: number;
  inUse: number;
  idle: number;
  total: number;
  timestamp?: string;
};

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------

/**
 * Record a telemetry metric through the OpenTelemetry Meter (`count` ->
 * Counter, `value` -> Gauge). Use this directly for domain-specific metric
 * types (e.g. loop.runner.*); use the typed wrappers below for the
 * queue/protocol metric families.
 */
export function emitTelemetryMetric<T extends { metric: string }>(
  metric: T
): void {
  // gatewaySessionId is a session-correlation token that must never be
  // recorded raw. Redact to the stable hash; same id in means same hash out.
  const payload: Record<string, unknown> = { ...metric };
  if (typeof payload.gatewaySessionId === "string") {
    payload.gatewaySessionId = redactGatewaySessionId(payload.gatewaySessionId);
  }
  recordOtelMetric(payload);
}

export function emitQueueMetric(metric: QueueMetric): void {
  emitTelemetryMetric(metric);
}

export function emitProtocolMetric(metric: ProtocolMetric): void {
  emitTelemetryMetric(metric);
}

export function emitDbPoolMetric(metric: DbPoolMetric): void {
  emitTelemetryMetric(metric);
}

// ---------------------------------------------------------------------------
// OpenTelemetry Meter recording
// ---------------------------------------------------------------------------

const METER_NAME = "@repo/observability";

/** High-cardinality or per-sample fields that must not become metric attributes. */
const METRIC_ATTRIBUTE_EXCLUDED_KEYS = new Set([
  "metric",
  "count",
  "value",
  "timestamp",
  "commandId",
  "gatewaySessionId",
  "poolMax",
  "waitingCount",
  "inUse",
  "idle",
  "total",
]);

type MetricAttributes = Record<string, string | number | boolean>;

const counterCache = new WeakMap<Meter, Map<string, Counter>>();
const gaugeCache = new WeakMap<Meter, Map<string, Gauge>>();

function recordOtelMetric(metric: Record<string, unknown>): void {
  try {
    const name = metric.metric;
    if (typeof name !== "string") {
      return;
    }
    const count = typeof metric.count === "number" ? metric.count : undefined;
    const value = typeof metric.value === "number" ? metric.value : undefined;
    if (count === undefined && value === undefined) {
      return;
    }
    const meter = metrics.getMeter(METER_NAME);
    const attributes = buildMetricAttributes(metric);
    if (count === undefined) {
      getInstrument(gaugeCache, meter, name, (m) => m.createGauge(name)).record(
        value as number,
        attributes
      );
    } else {
      getInstrument(counterCache, meter, name, (m) =>
        m.createCounter(name)
      ).add(count, attributes);
    }
  } catch {
    // Fail-open: telemetry must never break the caller.
  }
}

function getInstrument<T>(
  cache: WeakMap<Meter, Map<string, T>>,
  meter: Meter,
  name: string,
  create: (meter: Meter) => T
): T {
  let byName = cache.get(meter);
  if (!byName) {
    byName = new Map();
    cache.set(meter, byName);
  }
  let instrument = byName.get(name);
  if (!instrument) {
    instrument = create(meter);
    byName.set(name, instrument);
  }
  return instrument;
}

function buildMetricAttributes(
  metric: Record<string, unknown>
): MetricAttributes {
  const attributes: MetricAttributes = {};
  for (const [key, val] of Object.entries(metric)) {
    if (METRIC_ATTRIBUTE_EXCLUDED_KEYS.has(key) || isSensitiveKey(key)) {
      continue;
    }
    if (typeof val === "string") {
      attributes[key] = redactSensitiveText(val);
    } else if (typeof val === "number" || typeof val === "boolean") {
      attributes[key] = val;
    }
  }
  return attributes;
}
