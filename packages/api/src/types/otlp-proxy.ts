/** Shared contract of the authenticated OTLP proxy (`/otel/v1/{signal}`). */
export const OtlpProxySignal = {
  Traces: "traces",
  Metrics: "metrics",
  Logs: "logs",
} as const;
export type OtlpProxySignal =
  (typeof OtlpProxySignal)[keyof typeof OtlpProxySignal];

export const OTLP_PROXY_CONTENT_TYPE = "application/x-protobuf";
export const OTLP_PROXY_MAX_BODY_BYTES = 512 * 1024;
export const OTLP_PROXY_RETRY_AFTER_SECONDS = 30;

export function otlpProxyPath(signal: OtlpProxySignal): string {
  return `/otel/v1/${signal}`;
}

export function isOtlpProxySignal(value: unknown): value is OtlpProxySignal {
  return Object.values<unknown>(OtlpProxySignal).includes(value);
}
