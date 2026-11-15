import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "@repo/observability/log";
import { buildRequestCompletedContractAttributes } from "@repo/observability/telemetry/request-completed";
import { getTraceContext } from "@repo/observability/trace-context";
import {
  parseErrorReason,
  truncateReason,
} from "@/lib/auth/observe-failed-response";

const BASE_URL = "http://api.internal";
const MAX_CAPTURE_BYTES = 8 * 1024;
const CLIENT_ERROR_STATUS = 400;
const SERVER_ERROR_STATUS = 500;
const JSON_CONTENT_TYPE = "application/json";

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
  const capture = captureErrorBody(response);

  response.once("close", () => {
    try {
      const url = new URL(request.url ?? "/", BASE_URL);
      const method = request.method ?? "GET";
      const statusCode = response.statusCode;
      const durationMs = Math.round(now() - startMs);
      const reason =
        statusCode >= CLIENT_ERROR_STATUS
          ? truncateReason(
              parseErrorReason(capture.text()) ?? `HTTP ${statusCode}`
            )
          : undefined;
      const emit = resolveEmitter(statusCode, url.pathname);
      emit("request_completed", {
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
        ...(reason === undefined ? {} : { reason }),
        ...(response.writableFinished ? {} : { aborted: true }),
        ...(correlation
          ? { trace_id: correlation.traceId, span_id: correlation.spanId }
          : {}),
      });
    } catch {
      // observability: (d) logging code itself — it must never affect request handling.
    }
  });
}

function resolveEmitter(statusCode: number, pathname: string) {
  if (statusCode >= SERVER_ERROR_STATUS) {
    return log.warn;
  }
  if (statusCode < CLIENT_ERROR_STATUS && isHotPath(pathname)) {
    return log.debug;
  }
  return log.info;
}

function isHotPath(pathname: string): boolean {
  return HOT_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * Wrap `write`/`end` once to keep the first bytes of a JSON error body so the
 * failure reason can be logged. Calls through with the original arguments and
 * return value; capture problems never reach the response.
 */
function captureErrorBody(response: ServerResponse): { text: () => string } {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const collect = (chunk: unknown) => {
    try {
      if (bytes >= MAX_CAPTURE_BYTES || !shouldCapture(response)) {
        return;
      }
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk));
      } else {
        return;
      }
      bytes += chunks.at(-1)?.byteLength ?? 0;
    } catch {
      // observability: fail-open — body capture must never affect the response
    }
  };
  if (typeof response.write === "function") {
    const originalWrite = response.write;
    response.write = function patchedWrite(
      this: ServerResponse,
      ...args: unknown[]
    ) {
      collect(args[0]);
      return (originalWrite as (...a: unknown[]) => boolean).apply(this, args);
    } as typeof response.write;
  }
  if (typeof response.end === "function") {
    const originalEnd = response.end;
    response.end = function patchedEnd(
      this: ServerResponse,
      ...args: unknown[]
    ) {
      collect(args[0]);
      return (originalEnd as (...a: unknown[]) => ServerResponse).apply(
        this,
        args
      );
    } as typeof response.end;
  }
  return {
    text: () => Buffer.concat(chunks).subarray(0, MAX_CAPTURE_BYTES).toString(),
  };
}

function shouldCapture(response: ServerResponse): boolean {
  if (
    response.statusCode < CLIENT_ERROR_STATUS ||
    typeof response.getHeader !== "function"
  ) {
    return false;
  }
  const contentType = String(response.getHeader("content-type") ?? "");
  return (
    contentType.toLowerCase().includes(JSON_CONTENT_TYPE) &&
    !response.getHeader("content-encoding")
  );
}

const HOT_PATH_PATTERNS = [
  /^\/health(\/|$)/,
  /^\/cron\//,
  /^\/otel\/v1\//,
  /^\/loops\/[^/]+\/heartbeat$/,
  /^\/compute-targets\/[^/]+\/heartbeat$/,
];
