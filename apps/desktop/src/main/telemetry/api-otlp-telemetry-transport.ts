import {
  OTLP_PROXY_CONTENT_TYPE,
  OTLP_PROXY_MAX_BODY_BYTES,
  OTLP_PROXY_RETRY_AFTER_SECONDS,
  type OtlpProxySignal,
  otlpProxyPath,
} from "@repo/api/src/types/otlp-proxy";
import { gatewayLog } from "../logging/gateway-logger.js";
import type { DesktopTelemetryTransport } from "./relay-telemetry-transport.js";

const LOG_TAG = "otel";
const TRAILING_SLASHES_RE = /\/+$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_IN_FLIGHT = 4;
const DEFAULT_DRAIN_MS = 1500;
const MS_PER_SECOND = 1000;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNAVAILABLE = 503;

export type ApiOtlpTelemetryTransportOptions = {
  apiUrl: string;
  getApiKey: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxInFlight?: number;
  drainMs?: number;
  now?: () => number;
};

/**
 * Ships OTLP protobuf bodies to the API's authenticated `/otel/v1/*` proxy.
 * Best-effort: never throws, drops instead of queueing.
 */
export function createApiOtlpTelemetryTransport(
  options: ApiOtlpTelemetryTransportOptions
): DesktopTelemetryTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const drainMs = options.drainMs ?? DEFAULT_DRAIN_MS;
  const now = options.now ?? Date.now;
  const baseUrl = options.apiUrl.replace(TRAILING_SLASHES_RE, "");
  const inFlight = new Set<Promise<boolean>>();
  let disabled = false;
  let stopped = false;
  let pausedUntil = 0;

  const disable = (level: "info" | "warn", message: string) => {
    if (disabled) {
      return;
    }
    disabled = true;
    gatewayLog[level](LOG_TAG, message);
  };

  const pauseFrom = (response: Response) => {
    const retryAfter = Number(response.headers.get("retry-after"));
    const seconds =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : OTLP_PROXY_RETRY_AFTER_SECONDS;
    pausedUntil = now() + seconds * MS_PER_SECOND;
  };

  const handleStatus = (response: Response): boolean => {
    if (response.ok) {
      return true;
    }
    switch (response.status) {
      case HTTP_NOT_FOUND:
        disable(
          "info",
          "API telemetry is off (no OTLP endpoint); runner telemetry disabled"
        );
        break;
      case HTTP_UNAUTHORIZED:
      case HTTP_FORBIDDEN:
        disable(
          "warn",
          "API rejected runner telemetry credentials; runner telemetry disabled"
        );
        break;
      case HTTP_TOO_MANY_REQUESTS:
      case HTTP_UNAVAILABLE:
        pauseFrom(response);
        break;
      default:
        break;
    }
    return false;
  };

  const send = async (
    signal: OtlpProxySignal,
    body: Uint8Array,
    apiKey: string
  ): Promise<boolean> => {
    try {
      const response = await fetchImpl(`${baseUrl}${otlpProxyPath(signal)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": OTLP_PROXY_CONTENT_TYPE,
        },
        body: new Blob([new Uint8Array(body)]),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return handleStatus(response);
    } catch {
      return false;
    }
  };

  const flush = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delay = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, drainMs);
      timer.unref?.();
    });
    try {
      await Promise.race([Promise.allSettled([...inFlight]), delay]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    start: () => undefined,
    export: (signal, body) => {
      try {
        const apiKey = options.getApiKey();
        if (
          disabled ||
          stopped ||
          now() < pausedUntil ||
          !apiKey ||
          body.byteLength > OTLP_PROXY_MAX_BODY_BYTES ||
          inFlight.size >= maxInFlight
        ) {
          return Promise.resolve(false);
        }
        const promise = send(signal, body, apiKey);
        inFlight.add(promise);
        promise.finally(() => inFlight.delete(promise)).catch(() => undefined);
        return promise;
      } catch {
        return Promise.resolve(false);
      }
    },
    flush,
    stop: async () => {
      await flush();
      stopped = true;
    },
  };
}
