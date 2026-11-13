import { log } from "@repo/observability/log";
import { emitDbPoolMetric } from "@repo/observability/telemetry/metrics";
import { ORIGIN } from "@repo/observability/telemetry/origin";
import type { TelemetryConfig } from "@repo/observability/tracing/config";
import { TelemetryDisabledReason } from "@repo/observability/tracing/config";

/**
 * Registers the API instrumentation that depends on Node-only modules.
 *
 * Telemetry must start before the database import: PgInstrumentation patches
 * `pg` at module-evaluation time, while `packages/database/index.ts` imports
 * `pg` (and `@prisma/adapter-pg`) at module scope. If `@repo/database` is
 * loaded first, `pg` is never patched and the process produces no DB spans.
 * Keep `registerPoolTelemetry`'s import dynamic and after `registerTelemetry()`.
 */
export async function registerNodeInstrumentation(): Promise<void> {
  await registerTelemetry();
  await registerPoolTelemetry();
}

/**
 * Starts OpenTelemetry (traces, logs, metrics).
 *
 * The import AND the initialisation share one fail-open boundary: module
 * resolution happens before `initTelemetry` runs, and telemetry must never
 * fail the API cold start. `MissingEndpoint` is the expected local state and
 * stays quiet.
 */
async function registerTelemetry(): Promise<void> {
  let result: TelemetryConfig;
  try {
    const { initTelemetry } = await import(
      "@repo/observability/tracing/provider"
    );
    result = initTelemetry();
  } catch {
    log.warn("telemetry.disabled", {
      reason: TelemetryDisabledReason.InitFailed,
    });
    return;
  }

  if (result.enabled) {
    log.info("telemetry.initialized", {
      service: result.service,
      sampleRatio: result.sampleRatio,
    });
    return;
  }
  if (result.reason !== TelemetryDisabledReason.MissingEndpoint) {
    log.warn("telemetry.disabled", { reason: result.reason });
  }
}

/**
 * Injects the pool telemetry emitter into the database package.
 *
 * `@repo/database` intentionally has no `@repo/observability` dependency. The
 * database import remains dynamic so it occurs only after telemetry patches
 * `pg` in `registerTelemetry()`.
 */
async function registerPoolTelemetry(): Promise<void> {
  const { setPoolTelemetrySink } = await import("@repo/database");
  setPoolTelemetrySink((sample) =>
    emitDbPoolMetric({ ...sample, origin: ORIGIN })
  );
}
