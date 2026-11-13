import {
  isOtlpProxySignal,
  OTLP_PROXY_CONTENT_TYPE,
  OTLP_PROXY_MAX_BODY_BYTES,
  OTLP_PROXY_RETRY_AFTER_SECONDS,
  type OtlpProxySignal,
} from "@repo/api/src/types/otlp-proxy";
import { log } from "@repo/observability/log";
import { resolveTelemetryConfig } from "@repo/observability/tracing/config";
import { FixedWindowRateLimiter } from "@/lib/fixed-window-rate-limiter";
import { readCappedRequestBytes } from "@/lib/route-utils";

const TRAILING_SLASHES = /\/+$/;
const MAX_IN_FLIGHT = 32;
const UPSTREAM_TIMEOUT_MS = 5000;
const BODY_READ_TIMEOUT_MS = 5000;
const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

const rateLimiter = new FixedWindowRateLimiter({
  maxRequests: 240,
  windowMs: 60_000,
});
let inFlight = 0;

export type OtlpProxyResult = {
  status: number;
  retryAfterSeconds?: number;
};

type ResolveUpstreamResult = { ok: true; baseUrl: string } | { ok: false };

export const otlpProxyService = { resolveUpstream, precheck, forward };

/** The upstream comes from server configuration only, never from request data. */
function resolveUpstream(): ResolveUpstreamResult {
  const config = resolveTelemetryConfig();
  if (!config.enabled) {
    return { ok: false };
  }
  try {
    const url = new URL(config.endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false };
    }
    if (url.username || url.password) {
      return { ok: false };
    }
    const path = url.pathname.replace(TRAILING_SLASHES, "");
    return { ok: true, baseUrl: `${url.origin}${path}` };
  } catch {
    return { ok: false };
  }
}

function precheck(request: Request, signal: string): OtlpProxyResult | null {
  if (!(resolveUpstream().ok && isOtlpProxySignal(signal))) {
    return { status: 404 };
  }
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== OTLP_PROXY_CONTENT_TYPE) {
    return { status: 415 };
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number(contentLength) > OTLP_PROXY_MAX_BODY_BYTES
  ) {
    return { status: 413 };
  }
  return null;
}

async function forward(input: {
  principalKey: string;
  signal: OtlpProxySignal;
  request: Request;
  fetchImpl?: typeof fetch;
}): Promise<OtlpProxyResult> {
  const { principalKey, signal, request } = input;
  const fetchImpl = input.fetchImpl ?? fetch;

  const upstream = resolveUpstream();
  if (!upstream.ok) {
    return { status: 404 };
  }
  if (!rateLimiter.attempt(principalKey, Date.now())) {
    return { status: 429, retryAfterSeconds: RATE_LIMIT_RETRY_AFTER_SECONDS };
  }
  if (inFlight >= MAX_IN_FLIGHT) {
    return { status: 429, retryAfterSeconds: OTLP_PROXY_RETRY_AFTER_SECONDS };
  }

  inFlight += 1;
  try {
    const body = await readBodyWithDeadline(request);
    if (body === "timeout") {
      return { status: 408 };
    }
    if (!body.ok) {
      return { status: 413 };
    }
    if (body.value.byteLength === 0) {
      return { status: 400 };
    }
    return await sendUpstream(fetchImpl, upstream.baseUrl, signal, body.value);
  } finally {
    inFlight -= 1;
  }
}

async function sendUpstream(
  fetchImpl: typeof fetch,
  baseUrl: string,
  signal: OtlpProxySignal,
  body: Uint8Array
): Promise<OtlpProxyResult> {
  const unavailable: OtlpProxyResult = {
    status: 503,
    retryAfterSeconds: OTLP_PROXY_RETRY_AFTER_SECONDS,
  };
  try {
    const response = await fetchImpl(`${baseUrl}/v1/${signal}`, {
      method: "POST",
      headers: { "Content-Type": OTLP_PROXY_CONTENT_TYPE },
      body: body as BodyInit,
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) {
      return { status: 200 };
    }
    log.warn("otlp_proxy.upstream_failed", { status: response.status, signal });
    return response.status >= 500 ? unavailable : { status: 400 };
  } catch {
    log.warn("otlp_proxy.upstream_failed", { status: 0, signal });
    return unavailable;
  }
}

/** A slow upload must not hold an in-flight slot: give the read a deadline. */
async function readBodyWithDeadline(
  request: Request
): Promise<Awaited<ReturnType<typeof readCappedRequestBytes>> | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), BODY_READ_TIMEOUT_MS);
  });
  const read = readCappedRequestBytes(request, OTLP_PROXY_MAX_BODY_BYTES);
  // If the deadline wins, the pending read rejects once the body is cancelled.
  read.catch(() => undefined);
  try {
    const result = await Promise.race([read, deadline]);
    if (result === "timeout") {
      await request.body?.cancel().catch(() => undefined);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}
