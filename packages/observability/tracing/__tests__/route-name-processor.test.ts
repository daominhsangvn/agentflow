import { SpanKind, trace } from "@opentelemetry/api";
import type { ReadableSpan, Span } from "@opentelemetry/sdk-trace-node";
import { ATTR_HTTP_ROUTE } from "@opentelemetry/semantic-conventions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEnvForTest } from "../../__tests__/test-helpers";
import { initTelemetry, resetTelemetryForTest } from "../provider";
import { RouteNameSpanProcessor } from "../route-name-processor";

// ---------------------------------------------------------------------------
// tracing/route-name-processor.ts
//
// `next.span_name` holds "<METHOD> <route>" exactly when the route resolved.
// These pin that the route part reaches `http.route`, that a bare method is
// not mistaken for a route, and that only SERVER spans are stamped (CLIENT
// fetch spans carry full URLs in the same attribute).
//
// The write must go through `setAttribute` during `onEnding`, not through the
// ended span's attribute bag.
// ---------------------------------------------------------------------------

const ATTR_NEXT_SPAN_NAME = "next.span_name";
const BRANCHES_ROUTE = "/branches/route";
const BRANCHES_SPAN_NAME = `GET ${BRANCHES_ROUTE}`;
const GITHUB_FETCH_SPAN_NAME =
  "fetch GET https://api.github.com/repos/agentflow-ai/symphony-alpha/pulls?state=open&per_page=100";
const BARE_METHOD_SPAN_NAME = "GET";
const RSC_BRANCHES_SPAN_NAME = `RSC GET ${BRANCHES_ROUTE}`;

afterEach(async () => {
  await resetTelemetryForTest();
  vi.unstubAllEnvs();
});

/**
 * A span carrying only what this processor reads, plus a `setAttribute` that
 * records writes separately from the readable attribute bag.
 */
function fakeSpan(
  kind: SpanKind,
  attributes: Record<string, unknown>
): Span & { written: Record<string, unknown> } {
  const written: Record<string, unknown> = {};
  const span = {
    kind,
    attributes,
    written,
    setAttribute(key: string, value: unknown) {
      written[key] = value;
      return span;
    },
  };
  return span as unknown as Span & { written: Record<string, unknown> };
}

function enableTracingEnv(): void {
  deleteEnvForTest(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SDK_DISABLED",
    "OTEL_TRACES_SAMPLER",
    "OTEL_TRACES_SAMPLER_ARG"
  );
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:1");
  // Pinned: the root sampler is trace-id-ratio based.
  vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "1.0");
}

describe("RouteNameSpanProcessor", () => {
  it("stamps the route part of the span name as http.route", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBe(BRANCHES_ROUTE);
  });

  it("stamps through setAttribute rather than the readable attribute bag", () => {
    const span = fakeSpan(
      SpanKind.SERVER,
      Object.freeze({ [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME })
    );

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBe(BRANCHES_ROUTE);
  });

  it("strips the RSC prefix", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_NEXT_SPAN_NAME]: RSC_BRANCHES_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBe(BRANCHES_ROUTE);
  });

  it("skips a bare method", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_NEXT_SPAN_NAME]: BARE_METHOD_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBeUndefined();
  });

  it("does not stamp a CLIENT fetch span", () => {
    const span = fakeSpan(SpanKind.CLIENT, {
      [ATTR_NEXT_SPAN_NAME]: GITHUB_FETCH_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBeUndefined();
  });

  it("leaves a pg client span untouched", () => {
    const span = fakeSpan(SpanKind.CLIENT, {
      "db.system.name": "postgresql",
      "db.namespace": "app",
      "db.statement.text": "SELECT 1",
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBeUndefined();
  });

  it("leaves an internal Next span untouched", () => {
    const span = fakeSpan(SpanKind.INTERNAL, {
      [ATTR_NEXT_SPAN_NAME]: "executing api route (app) /branches",
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBeUndefined();
  });

  it("does not overwrite an http.route that is already set", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_HTTP_ROUTE]: "/already/set",
      [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written[ATTR_HTTP_ROUTE]).toBeUndefined();
  });

  it("does not write resource.name", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME,
    });

    new RouteNameSpanProcessor().onEnding(span);

    expect(span.written["resource.name"]).toBeUndefined();
  });

  it("does not throw when the span rejects the write", () => {
    const span = fakeSpan(SpanKind.SERVER, {
      [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME,
    });
    span.setAttribute = () => {
      throw new Error("attributes are immutable");
    };

    expect(() => new RouteNameSpanProcessor().onEnding(span)).not.toThrow();
  });
});

describe("initTelemetry route-name wiring", () => {
  it("stamps http.route on a SERVER span produced by the live tracer", () => {
    enableTracingEnv();
    expect(initTelemetry().enabled).toBe(true);

    const span = trace.getTracer("test").startSpan("GET", {
      kind: SpanKind.SERVER,
      attributes: { [ATTR_NEXT_SPAN_NAME]: BRANCHES_SPAN_NAME },
    });
    span.end();

    const ended = span as unknown as ReadableSpan;
    expect(ended.attributes[ATTR_HTTP_ROUTE]).toBe(BRANCHES_ROUTE);
  });

  it("leaves a CLIENT fetch span produced by the live tracer untouched", () => {
    enableTracingEnv();
    expect(initTelemetry().enabled).toBe(true);

    const span = trace.getTracer("test").startSpan("fetch GET", {
      kind: SpanKind.CLIENT,
      attributes: { [ATTR_NEXT_SPAN_NAME]: GITHUB_FETCH_SPAN_NAME },
    });
    span.end();

    const ended = span as unknown as ReadableSpan;
    expect(ended.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
  });
});
