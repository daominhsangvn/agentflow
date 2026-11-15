// ---------------------------------------------------------------------------
// Query-string redaction for HTTP spans.
//
// The undici and http instrumentations record the raw request URL. Webhook
// URLs (e.g. Teams Workflows) carry a signature in the query (`sig=`) and OAuth
// callbacks carry `code=`, so the sensitive parameter values are replaced before
// the span is exported.
// Keep in sync with the collector `blocked_values` entry in
// deploy/observability/otel-collector-config.yaml.
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";

/**
 * Query parameters whose values are redacted. Shared by the regex below and by
 * `HttpInstrumentation`'s `redactedQueryParams` (which REPLACES its defaults,
 * so the defaults are listed here too).
 */
export const SENSITIVE_QUERY_PARAMS: readonly string[] = [
  "sig",
  "signature",
  "Signature",
  "AWSAccessKeyId",
  "X-Goog-Signature",
  "code",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "key",
  "api_key",
  "apikey",
  "client_secret",
  "secret",
  "password",
];

type UndiciRequestLike = {
  origin?: string | URL;
  path?: string;
};

type HttpRequestOptionsLike = {
  protocol?: string | null;
  hostname?: string | null;
  host?: string | null;
  port?: string | number | null;
  path?: string | null;
};

type SpanUrlAttributes = Record<string, string>;

export const SENSITIVE_QUERY_PARAM_RE = buildSensitiveQueryParamRegex(
  SENSITIVE_QUERY_PARAMS
);

export function redactUrlQuery(url: string): string {
  return url.replaceAll(SENSITIVE_QUERY_PARAM_RE, `$1${REDACTED}`);
}

/** `startSpanHook` for UndiciInstrumentation: overrides url.full / url.query. */
export function undiciUrlAttributes(
  request: UndiciRequestLike
): SpanUrlAttributes {
  try {
    const url = new URL(request.path ?? "/", request.origin);
    return {
      "url.full": redactUrlQuery(url.toString()),
      "url.query": redactUrlQuery(url.search),
    };
  } catch {
    return {};
  }
}

/** `startOutgoingSpanHook` for HttpInstrumentation: overrides url.full. */
export function httpUrlAttributes(
  options: HttpRequestOptionsLike
): SpanUrlAttributes {
  try {
    const protocol = options.protocol ?? "http:";
    const url = new URL(
      options.path ?? "/",
      `${protocol}//${resolveHttpAuthority(options)}`
    );
    return { "url.full": redactUrlQuery(url.toString()) };
  } catch {
    return {};
  }
}

/** `startIncomingSpanHook` for HttpInstrumentation: redacts url.query. */
export function httpIncomingUrlAttributes(request: {
  url?: string;
}): SpanUrlAttributes {
  try {
    const url = new URL(request.url ?? "/", "http://api.internal");
    if (url.search.length <= 1) {
      return {};
    }
    return { "url.query": redactUrlQuery(url.search).slice(1) };
  } catch {
    return {};
  }
}

function resolveHttpAuthority(options: HttpRequestOptionsLike): string {
  const port = options.port ? `:${options.port}` : "";
  if (options.hostname) {
    return `${options.hostname}${port}`;
  }
  const host = options.host ?? "localhost";
  if (!port || hasPort(host)) {
    return host;
  }
  return `${host}${port}`;
}

function hasPort(host: string): boolean {
  if (host.startsWith("[")) {
    return host.includes("]:");
  }
  return host.includes(":");
}

function buildSensitiveQueryParamRegex(params: readonly string[]): RegExp {
  const names = [...new Set(params.map((name) => name.toLowerCase()))].map(
    (name) => name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
  );
  return new RegExp(String.raw`([?&](?:${names.join("|")})=)[^&#\s]*`, "gi");
}
