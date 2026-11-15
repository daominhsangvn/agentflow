// Test-only helper. Lives outside `__tests__` so apps can import it by subpath
// (`@repo/observability/testing/in-memory-spans`). Never import from runtime code.

import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

export const TestSpanStatus = { Unset: 0, Ok: 1, Error: 2 } as const;
export type TestSpanStatus =
  (typeof TestSpanStatus)[keyof typeof TestSpanStatus];

export type RecordedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string };
  events: { name: string; attributes?: Record<string, unknown> }[];
  links: { traceId: string; spanId: string }[];
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

export type InMemorySpans = {
  spans: () => RecordedSpan[];
  reset: () => void;
  uninstall: () => void;
};

export function installInMemorySpans(): InMemorySpans {
  trace.disable();
  context.disable();
  const exporter = new InMemorySpanExporter();
  new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).register();
  return {
    spans: () =>
      exporter.getFinishedSpans().map((span) => ({
        name: span.name,
        attributes: { ...span.attributes },
        status: { code: span.status.code, message: span.status.message },
        events: span.events.map((event) => ({
          name: event.name,
          attributes: event.attributes,
        })),
        links: span.links.map((link) => ({
          traceId: link.context.traceId,
          spanId: link.context.spanId,
        })),
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: span.parentSpanContext?.spanId,
      })),
    reset: () => exporter.reset(),
    uninstall: () => {
      trace.disable();
      context.disable();
    },
  };
}
