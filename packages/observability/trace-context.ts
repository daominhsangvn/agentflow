// ---------------------------------------------------------------------------
// Trace-context bridge for the structured logger (ISS-4659).
//
// `@repo/observability/log` is imported by client components — see the
// `typeof window === "undefined"` guard at the bottom of log.ts, and the live
// importers `packages/collaboration/client/liveblocks-error-boundary.tsx` and
// `apps/web/app/[locale]/global-error.tsx`. It therefore must NEVER statically
// import an OpenTelemetry package: that would pull the Node SDK into every
// browser bundle that reaches the logger.
//
// Instead the server-side tracer registers a provider here at startup, and the
// logger reads the active trace through this indirection. With no provider
// registered — every browser bundle, and any server runtime with tracing
// disabled — this module is a handful of bytes and returns `undefined`.
//
// This mirrors the existing `setPoolTelemetrySink` injection in
// `packages/database`, which exists for the same reason: to keep a package free
// of a dependency it must not carry.
// ---------------------------------------------------------------------------

import { globalSlot } from "./global-slot";

/** The active span's identifiers, as OpenTelemetry reports them (lowercase hex). */
export type TraceContext = {
  /** 128-bit trace id, 32 lowercase hex characters. */
  traceId: string;
  /** 64-bit span id, 16 lowercase hex characters. */
  spanId: string;
  /** Active `af.*` ids (e.g. `af.loop_id`), when any are known. */
  afIds?: Record<string, string>;
};

/** Returns the currently-active trace context, or `undefined` when untraced. */
export type TraceContextProvider = () => TraceContext | undefined;

const noTraceContext: TraceContextProvider = () => undefined;

const providerSlot = globalSlot<TraceContextProvider>(
  "trace-context",
  () => noTraceContext
);

/**
 * Register the process-wide trace-context provider. Called once by the tracer
 * bootstrap in `@repo/observability/tracing`; never by application code.
 */
export function setTraceContextProvider(provider: TraceContextProvider): void {
  providerSlot.value = provider;
}

/** Restore the default no-op provider. Used by tests and by tracer shutdown. */
export function resetTraceContextProvider(): void {
  providerSlot.value = noTraceContext;
}

/**
 * Read the active trace context. Never throws — a provider that fails must not
 * be able to break a `log.info()` call.
 */
export function getTraceContext(): TraceContext | undefined {
  try {
    return providerSlot.value();
  } catch {
    return undefined;
  }
}

/**
 * Map a trace context onto the log attributes backends join traces on.
 *
 * Uses the OpenTelemetry log data-model names (`trace_id`, `span_id`) with the
 * W3C lowercase hex encoding.
 */
export function toLogCorrelationFields(
  context: TraceContext
): Record<string, string> {
  return {
    trace_id: context.traceId,
    span_id: context.spanId,
    ...context.afIds,
  };
}
