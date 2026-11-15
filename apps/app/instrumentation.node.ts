import { log } from "@repo/observability/log";
import type { TelemetryConfig } from "@repo/observability/tracing/config";
import { TelemetryDisabledReason } from "@repo/observability/tracing/config";

/**
 * Starts OpenTelemetry (service `af-app`).
 *
 * The import AND the initialisation share one fail-open boundary: telemetry
 * must never fail the app cold start. `MissingEndpoint` is the expected local
 * state and stays quiet.
 *
 * Default signal handling is intentional: the Next standalone server owns
 * SIGTERM/SIGINT, so the provider installs its own shutdown listener.
 */
export async function registerNodeInstrumentation(): Promise<void> {
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
