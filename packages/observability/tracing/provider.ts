// ---------------------------------------------------------------------------
// OpenTelemetry bootstrap for server runtimes (traces, logs, metrics).
//
// This is the ONLY module in @repo/observability that imports the OpenTelemetry
// SDK. `log.ts` reaches the active trace through `../trace-context` and emits
// records through `../log-sink` instead, because the logger is bundled into
// browsers (see the header of those files). Keep it that way: a static OTel
// import anywhere in the logger's graph ships the Node SDK to every end user.
//
// Everything here is fail-open. Telemetry is a diagnostic aid; it must never
// add latency to, or fail, a request. Callers get a config result, never an
// exception.
// ---------------------------------------------------------------------------

import { context, metrics, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { globalSlot } from "../global-slot";
import type { LogLevel } from "../log";
import {
  type LogRecordInput,
  resetLogRecordSink,
  setLogRecordSink,
} from "../log-sink";
import { waitForDeadline } from "../shutdown";
import { resolveGitSha, resolveServerVersion } from "../telemetry/context";
import {
  resetTraceContextProvider,
  setTraceContextProvider,
} from "../trace-context";
import {
  resolveTelemetryConfig,
  type TelemetryConfig,
  TelemetryDisabledReason,
} from "./config";
import { resetTelemetryFlushHook, setTelemetryFlushHook } from "./hooks";
import { RemoteParentEntropySampler } from "./remote-parent-sampler";
import { RouteNameSpanProcessor } from "./route-name-processor";
import {
  httpIncomingUrlAttributes,
  httpUrlAttributes,
  SENSITIVE_QUERY_PARAMS,
  undiciUrlAttributes,
} from "./url-redaction";

/**
 * Resource attribute recording the head-sampling rate the process ran with, so
 * ingest volume is auditable from the spans themselves rather than from
 * whatever the deploy config happened to be at the time.
 */
const ATTR_TRACE_SAMPLE_RATE = "af.trace.sample_ratio";
const ATTR_VCS_REF_HEAD_REVISION = "vcs.ref.head.revision";
const METRIC_EXPORT_INTERVAL_MS = 15_000;
const LOGGER_NAME = "@repo/observability";
const UNTRACED_INCOMING_PATH_PREFIX = "/otel/v1/";
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

const LOG_SEVERITY: Record<LogLevel, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

type EnabledConfig = Extract<TelemetryConfig, { enabled: true }>;

type Flushable = { forceFlush(): Promise<void> };

type SdkHandle = {
  sdk: NodeSDK;
  flushables: Flushable[];
};

type ProviderState = {
  handle: SdkHandle | undefined;
  initResult: TelemetryConfig | undefined;
  installedHandlers: Array<{ event: string; listener: () => void }>;
};

// Shared across every copy of this module in the process (see global-slot.ts):
// a second copy must see the first copy's init outcome and never start a
// second SDK.
const state = globalSlot<ProviderState>("provider", () => ({
  handle: undefined,
  initResult: undefined,
  installedHandlers: [],
})).value;

/**
 * Initialise telemetry once per process. Safe to call repeatedly: subsequent
 * calls return the FIRST call's outcome.
 *
 * Returning the cached outcome matters: re-resolving the config on a later call
 * would report whatever the environment says *now*, which can disagree with the
 * SDK that actually got installed (or with a bootstrap that failed).
 *
 * Processes that own their shutdown (mcp, the runner) pass
 * `handleShutdownSignals: false` and call `flushTelemetry()` /
 * `shutdownTelemetry()` themselves. Next standalone (apps/app) keeps the
 * default; its telemetry shutdown may lose the race against Next's own
 * `process.exit` after `server.close()`.
 */
export function initTelemetry(
  options: InitTelemetryOptions = {}
): TelemetryConfig {
  if (state.initResult) {
    return state.initResult;
  }

  const config = resolveTelemetryConfig();
  state.initResult = config;
  if (!config.enabled) {
    return config;
  }

  let created: SdkHandle | undefined;
  try {
    created = createSdk(config);
    created.sdk.start();
    state.handle = created;
    setTraceContextProvider(readActiveTraceContext);
    setLogRecordSink(emitOtelLogRecord);
    setTelemetryFlushHook(forceFlushAll);
    registerShutdownHandlers(options);
    return config;
  } catch {
    // A failed bootstrap must leave the process untelemetered, not broken.
    state.handle = undefined;
    resetSeams();
    removeShutdownHandlers();
    abandonSdk(created);
    state.initResult = {
      enabled: false,
      reason: TelemetryDisabledReason.InitFailed,
    };
    return state.initResult;
  }
}

/** Flush and stop the SDK. Never rejects; gives up after `deadlineMs`. */
export async function shutdownTelemetry(deadlineMs = 5000): Promise<void> {
  const current = state.handle;
  state.handle = undefined;
  resetSeams();
  if (!current) {
    return;
  }
  try {
    await Promise.race([current.sdk.shutdown(), waitForDeadline(deadlineMs)]);
  } catch {
    // Shutdown must continue even if the backend is unavailable.
  }
}

/**
 * Test seam: tear telemetry down so a suite can re-initialise from a clean
 * state. **Await it** so the next test does not race a draining SDK.
 */
export async function resetTelemetryForTest(): Promise<void> {
  const current = state.handle;
  state.handle = undefined;
  state.initResult = undefined;
  resetSeams();
  removeShutdownHandlers();
  try {
    await current?.sdk.shutdown();
  } catch {
    // Teardown is best-effort; a failed shutdown must not fail the suite.
  }
  trace.disable();
  context.disable();
  logs.disable();
  metrics.disable();
}

function createSdk(config: EnabledConfig): SdkHandle {
  const collectorOrigin = originOf(config.endpoint);
  const spanProcessor = new BatchSpanProcessor(new OTLPTraceExporter());
  const logProcessor = new BatchLogRecordProcessor({
    exporter: new OTLPLogExporter(),
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
  });

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.service,
      [ATTR_SERVICE_VERSION]: resolveServerVersion(),
      [ATTR_VCS_REF_HEAD_REVISION]: resolveGitSha(),
      [ATTR_TRACE_SAMPLE_RATE]: config.sampleRatio,
    }),
    // Remote parents are sampled with SERVER-side entropy: a security
    // property, not a tuning choice. `traceparent` is an untrusted header on a
    // public origin, so neither the caller's sampled bit (AlwaysOn, the
    // `ParentBasedSampler` default) nor anything derived from the caller's
    // trace id can be trusted to bound export. See `./remote-parent-sampler`.
    // Root spans keep the trace-id ratio: we mint those ids ourselves.
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.sampleRatio),
      remoteParentSampled: new RemoteParentEntropySampler(config.sampleRatio),
    }),
    // The route-name processor stamps each SERVER span route onto
    // `http.route` in `onEnding`, ahead of any exporter's `onEnd`.
    spanProcessors: [new RouteNameSpanProcessor(), spanProcessor],
    logRecordProcessors: [logProcessor],
    metricReaders: [metricReader],
    instrumentations: [
      // Outgoing URLs can carry signatures in the query (Teams `sig=`) and
      // incoming ones OAuth codes (`/api/auth/*?code=`): the hooks overwrite the
      // URL attributes with redacted ones; `redactedQueryParams` covers the rest.
      // The OTLP proxy and the collector itself are never traced (amplification).
      new HttpInstrumentation({
        startOutgoingSpanHook: httpUrlAttributes,
        startIncomingSpanHook: httpIncomingUrlAttributes,
        redactedQueryParams: [...SENSITIVE_QUERY_PARAMS],
        ignoreIncomingRequestHook: (req) =>
          req.url?.startsWith(UNTRACED_INCOMING_PATH_PREFIX) === true,
        ignoreOutgoingRequestHook: (options) =>
          isCollectorOrigin(httpOptionsOrigin(options), collectorOrigin),
      }),
      new UndiciInstrumentation({
        startSpanHook: undiciUrlAttributes,
        ignoreRequestHook: (request) =>
          isCollectorOrigin(String(request.origin), collectorOrigin),
      }),
      // `pg` is what Prisma's driver adapter issues queries through.
      new PgInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });

  return { sdk, flushables: [spanProcessor, logProcessor, metricReader] };
}

function abandonSdk(created: SdkHandle | undefined): void {
  try {
    created?.sdk.shutdown().catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

function emitOtelLogRecord(record: LogRecordInput): void {
  logs.getLogger(LOGGER_NAME).emit({
    severityNumber: LOG_SEVERITY[record.level],
    severityText: record.level.toUpperCase(),
    body: record.message,
    attributes: record.attributes,
    timestamp: record.timestampMs,
    context: context.active(),
  });
}

/**
 * Flush buffered spans, logs and metrics. Application code does NOT call this
 * directly: it calls `flushTelemetry()` from `./hooks`, the SDK-free seam this
 * registers into.
 */
async function forceFlushAll(): Promise<void> {
  const flushables = state.handle?.flushables ?? [];
  await Promise.allSettled(flushables.map((item) => item.forceFlush()));
}

function resetSeams(): void {
  resetTelemetryFlushHook();
  resetTraceContextProvider();
  resetLogRecordSink();
}

function registerShutdownHandlers(options: InitTelemetryOptions): void {
  const onBeforeExit = () => {
    shutdownTelemetry().catch(() => undefined);
  };
  process.once("beforeExit", onBeforeExit);
  state.installedHandlers.push({ event: "beforeExit", listener: onBeforeExit });

  if (options.handleShutdownSignals === false) {
    return;
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    const listener = () => {
      shutdownTelemetry()
        .then(() => {
          // Re-raise only when nobody else (e.g. Next) handles the signal, so
          // default termination still happens.
          if (process.listenerCount(signal) === 0) {
            process.kill(process.pid, signal);
          }
        })
        .catch(() => undefined);
    };
    process.once(signal, listener);
    state.installedHandlers.push({ event: signal, listener });
  }
}

function removeShutdownHandlers(): void {
  for (const { event, listener } of state.installedHandlers) {
    process.removeListener(event, listener);
  }
  state.installedHandlers = [];
}

/**
 * Read the active span's ids for the logger. Returns `undefined` when there is
 * no recording span, so untraced log calls stay unchanged.
 *
 * The `isRecording()` check is load-bearing. A sampled-out span is still a real
 * object with a real `spanContext()`, so reading the ids unconditionally would
 * stamp `trace_id` onto logs for traces that are never exported.
 */
function readActiveTraceContext():
  | { traceId: string; spanId: string }
  | undefined {
  const span = trace.getSpan(context.active());
  if (!span?.isRecording()) {
    return undefined;
  }
  const spanContext = span.spanContext();
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}

export type InitTelemetryOptions = {
  /** Install SIGTERM/SIGINT listeners that shut telemetry down. Default true. */
  handleShutdownSignals?: boolean;
};

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function httpOptionsOrigin(options: {
  protocol?: string | null;
  hostname?: string | null;
  host?: string | null;
  port?: string | number | null;
}): string | undefined {
  const host = options.hostname ?? options.host;
  if (!host) {
    return undefined;
  }
  const port = options.port && !host.includes(":") ? `:${options.port}` : "";
  return originOf(`${options.protocol ?? "http:"}//${host}${port}`);
}

function isCollectorOrigin(
  origin: string | undefined,
  collectorOrigin: string | undefined
): boolean {
  if (!(origin && collectorOrigin)) {
    return false;
  }
  return originOf(origin) === collectorOrigin;
}
