// ---------------------------------------------------------------------------
// Query-string redaction for outgoing HTTP client spans.
//
// The undici and http instrumentations record the raw request URL. Webhook
// URLs (e.g. Teams Workflows) carry a signature in the query (`sig=`), so the
// sensitive parameter values are replaced before the span is exported.
// Keep in sync with the collector `blocked_values` entry in
// deploy/observability/otel-collector-config.yaml.
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";

const SENSITIVE_QUERY_PARAM_RE =
  /([?&](?:sig|signature|code|token|access_token|refresh_token|id_token|key|api_key|apikey|client_secret|secret|password)=)[^&#\s]*/gi;

interface UndiciRequestLike {
  origin?: string | URL;
  path?: string;
}

interface HttpRequestOptionsLike {
  protocol?: string | null;
  hostname?: string | null;
  host?: string | null;
  port?: string | number | null;
  path?: string | null;
}

type SpanUrlAttributes = Record<string, string>;

export function redactUrlQuery(url: string): string {
  return url.replaceAll(SENSITIVE_QUERY_PARAM_RE, `$1${REDACTED}`);
}

/** `startSpanHook` for UndiciInstrumentation: overrides url.full / url.query. */
export function undiciUrlAttributes(
  request: UndiciRequestLike
): SpanUrlAttributes {
  try {
    const url = new URL(request.path ?? "/", request.origin);
    return toSpanUrlAttributes(url.toString(), url.search);
  } catch {
    return {};
  }
}

/** `startOutgoingSpanHook` for HttpInstrumentation: overrides http.url. */
export function httpUrlAttributes(
  options: HttpRequestOptionsLike
): SpanUrlAttributes {
  try {
    const host = options.hostname ?? options.host ?? "localhost";
    const protocol = options.protocol ?? "http:";
    const port = options.port ? `:${options.port}` : "";
    const url = new URL(options.path ?? "/", `${protocol}//${host}${port}`);
    return toSpanUrlAttributes(url.toString(), url.search);
  } catch {
    return {};
  }
}

function toSpanUrlAttributes(
  fullUrl: string,
  query: string
): SpanUrlAttributes {
  const redactedUrl = redactUrlQuery(fullUrl);
  return {
    "url.full": redactedUrl,
    "http.url": redactedUrl,
    "url.query": redactUrlQuery(query),
  };
}
