import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "@repo/observability/log";
import { buildRequestCompletedContractAttributes } from "@repo/observability/telemetry/request-completed";
import { getTraceContext } from "@repo/observability/trace-context";

const BASE_URL = "http://api.internal";

/**
 * Emit exactly one `request_completed` log line per HTTP request, once the
 * response is closed. Called first in the server's request callback so the
 * duration covers the whole request and the trace context is captured while
 * the request span is still active.
 */
export function trackRequestCompleted(
  request: IncomingMessage,
  response: ServerResponse,
  now: () => number = () => globalThis.performance.now()
): void {
  const startMs = now();
  const correlation = getTraceContext();

  response.once("close", () => {
    try {
      const url = new URL(request.url ?? "/", BASE_URL);
      const method = request.method ?? "GET";
      const statusCode = response.statusCode;
      const durationMs = Math.round(now() - startMs);
      log.info("request_completed", {
        ...buildRequestCompletedContractAttributes({
          requestUrl: url.toString(),
          method,
          statusCode,
          durationMs,
        }),
        path: url.pathname,
        method,
        status_code: statusCode,
        duration_ms: durationMs,
        ...(response.writableFinished ? {} : { aborted: true }),
        ...(correlation
          ? { trace_id: correlation.traceId, span_id: correlation.spanId }
          : {}),
      });
    } catch {
      // Logging must never affect request handling.
    }
  });
}
