// ---------------------------------------------------------------------------
// Route identity for server spans.
//
// Next stamps `next.span_name` at span creation from the initial span name,
// and for the root request span that name is the bare method. It is rewritten
// to `"<METHOD> <route>"` only once `next.route` resolved, in the same
// `setAttributes` call that writes `http.route`. Spans that never resolved a
// route keep the bare method, which is not a route.
//
// This processor recovers the route part and stamps it as `http.route`, so
// the trace backend can group and filter request spans per route instead of
// per HTTP method. It never overwrites an `http.route` that is already set.
// ---------------------------------------------------------------------------

import type { Context } from "@opentelemetry/api";
import { SpanKind } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions";

/**
 * Next.js stamps this at span creation and rewrites it once the matched route
 * is known, so a root request span carries one of three shapes: `"<METHOD>
 * <route>"`, `"RSC <METHOD> <route>"` for an RSC request, or the bare method
 * when no route resolved.
 */
const ATTR_NEXT_SPAN_NAME = "next.span_name";

const RSC_PREFIX = "RSC ";

/**
 * Stamps `http.route` from Next's resolved route on each SERVER span, while
 * that span is still ending.
 *
 * The write happens in `onEnding`, the only point OTel sanctions for mutating
 * a span: `setAttribute` is still live, and every processor's `onEnding` runs
 * before any processor's `onEnd`, so the stamp lands ahead of the exporter
 * wherever this sits in `spanProcessors`.
 */
export class RouteNameSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // Next resolves the matched route while handling the request, so at start
    // there is nothing to copy yet. The work belongs in `onEnding`.
  }

  onEnding(span: Span): void {
    stampRoute(span);
  }

  onEnd(_span: ReadableSpan): void {
    // Required by `SpanProcessor`, deliberately empty: by `onEnd` the span is
    // already ended and mutating it is outside the OTel contract.
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Stamp `http.route` from Next's span name, leaving anything already set alone.
 *
 * Gated to SERVER spans: `next.span_name` is also stamped on CLIENT fetch
 * spans, where it holds the full request URL including the query string.
 *
 * Never throws. A rejected write costs one missing attribute; letting it
 * escape would break export for every span behind it.
 */
function stampRoute(span: Span): void {
  if (span.kind !== SpanKind.SERVER) {
    return;
  }
  if (span.attributes[ATTR_HTTP_ROUTE] !== undefined) {
    return;
  }
  const route = routeFromSpanName(span.attributes[ATTR_NEXT_SPAN_NAME]);
  if (route === undefined) {
    return;
  }
  try {
    span.setAttribute(ATTR_HTTP_ROUTE, route);
  } catch {
    // Best-effort by contract.
  }
}

/** Route part of `"[RSC ]<METHOD> <route>"`; undefined for a bare method. */
function routeFromSpanName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const name = (
    value.startsWith(RSC_PREFIX) ? value.slice(RSC_PREFIX.length) : value
  ).trim();
  const separator = name.indexOf(" ");
  if (separator === -1) {
    return undefined;
  }
  const route = name.slice(separator + 1).trim();
  return route.length > 0 ? route : undefined;
}
