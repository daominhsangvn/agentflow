import { afterEach, describe, expect, it, vi } from "vitest";
import { importLogWithSink } from "./test-helpers";

// ---------------------------------------------------------------------------
// log.ts x trace-context.ts — trace/log correlation, plus the OTel record
// contract. Stdout JSON carries trace ids from the registered provider; the
// emitted record does NOT (the SDK sink attaches them from the active context).
//
// Console spies are installed BEFORE the dynamic import because makeLogFn binds
// console.info/warn/error at module-init time.
// ---------------------------------------------------------------------------

const SAMPLE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SAMPLE_SPAN_ID = "00f067aa0ba902b7";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function importLogAndTraceContext() {
  const { log, records } = await importLogWithSink();
  const traceContext = await import("../trace-context");
  return { log, records, traceContext };
}

describe("stdout JSON line", () => {
  it("stamps the active trace ids and keeps them out of the record attributes", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { log, records, traceContext } = await importLogAndTraceContext();
    traceContext.setTraceContextProvider(() => ({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
    }));
    infoSpy.mockClear();
    records.length = 0;

    log.info("request_completed", { path: "/branches" });

    const parsed = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(parsed.trace_id).toBe(SAMPLE_TRACE_ID);
    expect(parsed.span_id).toBe(SAMPLE_SPAN_ID);
    expect(parsed.path).toBe("/branches");
    expect(records).toHaveLength(1);
    expect(records[0].attributes).not.toHaveProperty("trace_id");
    expect(records[0].attributes).not.toHaveProperty("span_id");
  });

  it("emits no correlation keys when nothing is traced", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { log } = await importLogAndTraceContext();
    infoSpy.mockClear();

    log.info("request_completed", { path: "/branches" });

    const parsed = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(parsed).not.toHaveProperty("trace_id");
    expect(parsed).not.toHaveProperty("span_id");
  });

  it("ignores caller-supplied trace ids so meta cannot spoof a trace", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { log, traceContext } = await importLogAndTraceContext();
    traceContext.setTraceContextProvider(() => ({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
    }));
    warnSpy.mockClear();

    log.warn("suspicious", {
      trace_id: "attacker-supplied",
      span_id: "attacker-supplied",
    });

    const parsed = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(parsed.trace_id).toBe(SAMPLE_TRACE_ID);
    expect(parsed.span_id).toBe(SAMPLE_SPAN_ID);
  });
});

describe("OTel log records", () => {
  it("carry level, message, redacted flattened attributes and origin", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { log, records } = await importLogAndTraceContext();
    records.length = 0;

    log.error("sync failed", {
      apiKey: "super-secret",
      inputTokens: 42,
      nested: { a: 1 },
    });

    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record.level).toBe("error");
    expect(record.message).toBe("sync failed");
    expect(record.attributes.apiKey).toBe("[redacted]");
    expect(record.attributes.inputTokens).toBe(42);
    expect(record.attributes["nested.a"]).toBe(1);
    expect(typeof record.attributes.origin).toBe("string");
    expect(typeof record.timestampMs).toBe("number");
  });

  it("redacts secret-shaped text in the message and drops spoofed correlation keys", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { log, records } = await importLogAndTraceContext();
    records.length = 0;

    log.info("token ghp_abcdefghijklmnopqrstuvwxyz0123 for a@b.com", {
      trace_id: "spoofed",
      span_id: "spoofed",
    });

    const [record] = records;
    expect(record.message).not.toContain("ghp_");
    expect(record.message).not.toContain("a@b.com");
    expect(record.attributes.trace_id).toBeUndefined();
    expect(record.attributes.span_id).toBeUndefined();
  });

  it("emits nothing and does not throw without a sink", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    const { log } = await import("../log");

    expect(() => log.info("no sink", { a: 1 })).not.toThrow();
  });
});

describe("log.flush", () => {
  it("resolves without a flush hook", async () => {
    vi.resetModules();
    const { log } = await import("../log");
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("runs the registered flush hook", async () => {
    vi.resetModules();
    const hooks = await import("../tracing/hooks");
    const hook = vi.fn().mockResolvedValue(undefined);
    hooks.setTelemetryFlushHook(hook);
    const { log } = await import("../log");

    await log.flush();

    expect(hook).toHaveBeenCalledOnce();
    hooks.resetTelemetryFlushHook();
  });
});
