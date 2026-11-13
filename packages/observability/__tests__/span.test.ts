import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AfAttribute, recordError, withSpan } from "../span";

describe("span helpers", () => {
  let exporter: InMemorySpanExporter;

  function register(): void {
    exporter = new InMemorySpanExporter();
    new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }).register();
  }

  beforeEach(() => {
    trace.disable();
    context.disable();
  });

  afterEach(() => {
    trace.disable();
    context.disable();
  });

  it("returns the fn result and ends the span with attributes", async () => {
    register();
    const result = await withSpan(
      "op",
      { [AfAttribute.OrgId]: "org_1" },
      () => 42
    );
    expect(result).toBe(42);
    const [span] = exporter.getFinishedSpans();
    expect(span.name).toBe("op");
    expect(span.attributes[AfAttribute.OrgId]).toBe("org_1");
  });

  it("creates child spans for nested calls", async () => {
    register();
    await withSpan("outer", {}, () => withSpan("inner", {}, () => 1));
    const spans = exporter.getFinishedSpans();
    const inner = spans.find((s) => s.name === "inner");
    const outer = spans.find((s) => s.name === "outer");
    expect(inner?.spanContext().traceId).toBe(outer?.spanContext().traceId);
    expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
  });

  it("records errors and rethrows", async () => {
    register();
    await expect(
      withSpan("boom", {}, () => {
        throw new Error("nope");
      })
    ).rejects.toThrow("nope");
    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("drops sensitive keys and redacts email values", async () => {
    register();
    await withSpan(
      "s",
      { password: "hunter2", note: "mail a@b.com now", skip: undefined },
      () => 1
    );
    const [span] = exporter.getFinishedSpans();
    expect(span.attributes.password).toBeUndefined();
    expect(span.attributes.skip).toBeUndefined();
    expect(String(span.attributes.note)).not.toContain("a@b.com");
  });

  it("recordError is a no-op without an active span", () => {
    register();
    expect(() => recordError(new Error("x"))).not.toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("runs fn when no provider is registered", async () => {
    await expect(withSpan("x", {}, () => "ok")).resolves.toBe("ok");
  });
});
