// ---------------------------------------------------------------------------
// SDK-free tracing seam (ISS-4659).
//
// This is the module application code imports to flush telemetry. It deliberately
// has NO OpenTelemetry import, so pulling it in never drags the Node SDK along.
//
// `apps/api/lib/route-utils.ts` is the reason. It is imported by ~40 route
// modules; if it reached the SDK through a static import, the first route that
// ever opts into the edge runtime would fail to build — the same class of
// evaluation-order trap that `apps/api/instrumentation.ts` already guards
// against with a dynamic import and an AST test. Routing the flush through a
// registered hook removes the hazard structurally instead of relying on nobody
// adding an edge route later.
//
// `./provider` registers the real implementation when the tracer starts; until
// then every call here is inert. Same injection shape as
// `setTraceContextProvider` in `../trace-context` and `setPoolTelemetrySink` in
// `packages/database`.
// ---------------------------------------------------------------------------

import { globalSlot } from "../global-slot";

/** Flushes buffered traces, logs and metrics. Registered by the telemetry bootstrap. */
export type TelemetryFlushHook = () => Promise<void>;

const hookSlot = globalSlot<TelemetryFlushHook | undefined>(
  "flush-hook",
  () => undefined
);

/**
 * Register the process-wide telemetry-flush implementation. Called once by
 * `./provider` after the tracer is installed; never by application code.
 */
export function setTelemetryFlushHook(hook: TelemetryFlushHook): void {
  hookSlot.value = hook;
}

/** Clear the hook. Used by tracer shutdown and by tests. */
export function resetTelemetryFlushHook(): void {
  hookSlot.value = undefined;
}

/**
 * Whether telemetry is installed and therefore has data worth flushing.
 *
 * Callers use this to avoid scheduling flush work at all when tracing is off —
 * every local run, every CI worker, any deploy with the kill switch set.
 * `flushTelemetry()` is already inert in that state, but *scheduling* it is not
 * free: it consumes a `waitUntil` slot on the response, and route
 * tests legitimately assert on how much deferred work a request schedules.
 */
export function isTelemetryActive(): boolean {
  return hookSlot.value !== undefined;
}

/**
 * Flush buffered traces, logs and metrics. Never rejects — a failed export must not surface as a
 * failed request — and resolves immediately when no tracer is installed.
 */
export async function flushTelemetry(): Promise<void> {
  const hook = hookSlot.value;
  if (!hook) {
    return;
  }
  try {
    await hook();
  } catch {
    // Best-effort, by contract.
  }
}
