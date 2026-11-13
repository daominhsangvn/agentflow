import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AfAttribute,
  recordError,
  runInLinkedSpan,
  setActiveSpanAttributes,
  withSpan,
} from "../span";

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

  it("recordError keeps a redacted stack", async () => {
    register();
    const token = `ghp_${"a".repeat(36)}`;
    const error = new Error("failed");
    error.stack = `Error: failed\n    at call (token=${token})`;
    await withSpan("s", {}, () => recordError(error));
    const [span] = exporter.getFinishedSpans();
    const event = span.events.find((e) => e.name === "exception");
    const stack = String(event?.attributes?.["exception.stacktrace"]);
    expect(stack).toContain("[redacted]");
    expect(stack).not.toContain(token);
  });

  it("setActiveSpanAttributes sets attributes and drops sensitive keys", async () => {
    register();
    await withSpan("s", {}, () => {
      setActiveSpanAttributes({ [AfAttribute.UserId]: "u_1", apiKey: "k" });
    });
    const [span] = exporter.getFinishedSpans();
    expect(span.attributes[AfAttribute.UserId]).toBe("u_1");
    expect(span.attributes.apiKey).toBeUndefined();
  });

  it("runInLinkedSpan starts a root span linked to the parent", async () => {
    register();
    await withSpan("parent", {}, () =>
      runInLinkedSpan("bg", {}, async () => 1)
    );
    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "parent");
    const bg = spans.find((s) => s.name === "bg");
    expect(bg?.parentSpanContext).toBeUndefined();
    expect(bg?.links).toHaveLength(1);
    expect(bg?.links[0].context.spanId).toBe(parent?.spanContext().spanId);
  });

  it("runInLinkedSpan marks errors and rethrows", async () => {
    register();
    await expect(
      runInLinkedSpan("bg", {}, () => Promise.reject(new Error("bad")))
    ).rejects.toThrow("bad");
    const [span] = exporter.getFinishedSpans();
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("runInLinkedSpan turns a synchronous throw into a rejection", async () => {
    const thunk = vi.fn((): Promise<number> => {
      throw new Error("sync boom");
    });
    vi.spyOn(trace, "getTracer").mockImplementation(() => {
      throw new Error("no tracer");
    });
    const pending = runInLinkedSpan("bg", {}, thunk);
    await expect(pending).rejects.toThrow("sync boom");
    expect(thunk).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("runInLinkedSpan never runs the thunk twice", async () => {
    const thunk = vi.fn(async () => 1);
    vi.spyOn(trace, "getTracer").mockImplementation(
      () =>
        ({
          startActiveSpan: (
            _name: string,
            _opts: unknown,
            cb: (span: unknown) => unknown
          ) => {
            cb({
              end: () => undefined,
              recordException: () => undefined,
              setStatus: () => undefined,
            });
            throw new Error("setup failed after start");
          },
        }) as never
    );
    await expect(runInLinkedSpan("bg", {}, thunk)).rejects.toThrow();
    expect(thunk).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
