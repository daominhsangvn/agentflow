// ---------------------------------------------------------------------------
// Telemetry configuration.
//
// Pure env resolution — deliberately free of any OpenTelemetry import so it can
// be unit-tested, and read from, without pulling the Node SDK in. The SDK lives
// behind `./provider`, which is the only module that imports it.
//
// Mirrors log.ts's `loadConfig()`: `keys()` first, falling back to raw
// `process.env` reads because `keys()` throws outside a Next.js runtime (the
// standalone relay, the containerized E2E server, a test worker).
// ---------------------------------------------------------------------------

import { keys } from "../keys";

/** Why telemetry is inert. Surfaced in diagnostics so a silent no-op is explainable. */
export const TelemetryDisabledReason = {
  /** `OTEL_SDK_DISABLED` was set truthy. */
  ExplicitlyDisabled: "explicitly_disabled",
  /** No `OTEL_EXPORTER_OTLP_ENDPOINT` — nowhere to export to. */
  MissingEndpoint: "missing_endpoint",
  /** The SDK bootstrap threw. The process stays untraced rather than broken. */
  InitFailed: "init_failed",
} as const;
export type TelemetryDisabledReason =
  (typeof TelemetryDisabledReason)[keyof typeof TelemetryDisabledReason];

export type TelemetryConfig =
  | {
      enabled: true;
      endpoint: string;
      service: string;
      sampleRatio: number;
    }
  | { enabled: false; reason: TelemetryDisabledReason };

const DEFAULT_SAMPLE_RATIO = 1;
const MIN_SAMPLE_RATIO = 0;
const MAX_SAMPLE_RATIO = 1;
const DEFAULT_SERVICE = "af-unknown";
const SAMPLER_ALWAYS_OFF = "always_off";

const TRUTHY_FLAG_VALUES = new Set(["1", "true"]);

type OtelEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT: string | undefined;
  OTEL_SERVICE_NAME: string | undefined;
  OTEL_TRACES_SAMPLER: string | undefined;
  OTEL_TRACES_SAMPLER_ARG: string | undefined;
  OTEL_SDK_DISABLED: string | undefined;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

function loadOtelEnv(): OtelEnv {
  try {
    const env = keys();
    return {
      OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
      OTEL_TRACES_SAMPLER: env.OTEL_TRACES_SAMPLER,
      OTEL_TRACES_SAMPLER_ARG: env.OTEL_TRACES_SAMPLER_ARG,
      OTEL_SDK_DISABLED: env.OTEL_SDK_DISABLED,
    };
  } catch {
    // keys() throws outside Next.js (standalone relay, container, test worker),
    // and on a malformed value such as a non-URL endpoint.
    return {
      OTEL_EXPORTER_OTLP_ENDPOINT: readEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
      OTEL_SERVICE_NAME: readEnv("OTEL_SERVICE_NAME"),
      OTEL_TRACES_SAMPLER: readEnv("OTEL_TRACES_SAMPLER"),
      OTEL_TRACES_SAMPLER_ARG: readEnv("OTEL_TRACES_SAMPLER_ARG"),
      OTEL_SDK_DISABLED: readEnv("OTEL_SDK_DISABLED"),
    };
  }
}

/**
 * Head-sampling ratio in [0, 1]. A malformed value falls back to the default
 * (sample everything) and out-of-range values are clamped.
 *
 * Parsed with `Number`, not `Number.parseFloat`: `parseFloat` accepts a numeric
 * PREFIX, so `"1oops"` would parse as `1`. `Number` rejects the whole string,
 * which keeps a typo on the documented fallback path instead of silently
 * passing as a valid value.
 */
export function resolveSampleRatio(): number {
  const env = loadOtelEnv();
  if (env.OTEL_TRACES_SAMPLER === SAMPLER_ALWAYS_OFF) {
    return MIN_SAMPLE_RATIO;
  }
  const raw = env.OTEL_TRACES_SAMPLER_ARG;
  if (raw === undefined) {
    return DEFAULT_SAMPLE_RATIO;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SAMPLE_RATIO;
  }
  return Math.min(MAX_SAMPLE_RATIO, Math.max(MIN_SAMPLE_RATIO, parsed));
}

/**
 * Whether this runtime should export telemetry. `OTEL_EXPORTER_OTLP_ENDPOINT`
 * is the on/off switch: unset means off, which is the safe direction.
 */
export function resolveTelemetryConfig(): TelemetryConfig {
  const env = loadOtelEnv();
  if (TRUTHY_FLAG_VALUES.has((env.OTEL_SDK_DISABLED ?? "").toLowerCase())) {
    return {
      enabled: false,
      reason: TelemetryDisabledReason.ExplicitlyDisabled,
    };
  }
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return { enabled: false, reason: TelemetryDisabledReason.MissingEndpoint };
  }
  return {
    enabled: true,
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    service: env.OTEL_SERVICE_NAME ?? DEFAULT_SERVICE,
    sampleRatio: resolveSampleRatio(),
  };
}
