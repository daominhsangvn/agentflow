import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryCategory } from "../telemetry/schema";
import { deleteEnvForTest } from "./test-helpers";

// ---------------------------------------------------------------------------
// log.ts — stdout sink. JSON line when LOG_FORMAT=json (or production unless
// LOG_FORMAT=pretty), readable (message, meta) form otherwise.
//
// Each test resets the module so the module-level format flag re-evaluates
// against the stubbed env.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function importLogFresh(): Promise<typeof import("../log").log> {
  vi.resetModules();
  const mod = await import("../log");
  return mod.log;
}

describe("LOG_FORMAT=json emits a single parseable JSON line", () => {
  it("flattens meta into top-level JSON keys", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const log = await importLogFresh();
    infoSpy.mockClear();

    log.info("Desktop telemetry event received", {
      category: TelemetryCategory.TokenCostPricingMiss,
      diagnostics: { tokenCostPricingMiss: { model: "gpt-5.4" } },
    });

    expect(infoSpy).toHaveBeenCalledOnce();
    const callArgs = infoSpy.mock.calls[0];
    expect(callArgs).toHaveLength(1);
    const parsed = JSON.parse(callArgs[0] as string);
    expect(parsed.message).toBe("Desktop telemetry event received");
    expect(parsed.level).toBe("info");
    expect(parsed.category).toBe(TelemetryCategory.TokenCostPricingMiss);
    expect(parsed.diagnostics.tokenCostPricingMiss.model).toBe("gpt-5.4");
    expect(typeof parsed.origin).toBe("string");
  });

  it("message and level are authoritative even if meta carries colliding keys", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const log = await importLogFresh();
    warnSpy.mockClear();

    log.warn("real message", { message: "spoofed", level: "debug", a: 1 });

    const parsed = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(parsed.message).toBe("real message");
    expect(parsed.level).toBe("warn");
    expect(parsed.a).toBe(1);
  });
});

describe("readable console", () => {
  it("keeps the (message, object) form when LOG_FORMAT is unset outside production", async () => {
    deleteEnvForTest("LOG_FORMAT");
    vi.stubEnv("NODE_ENV", "development");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const log = await importLogFresh();
    infoSpy.mockClear();

    const meta = { category: TelemetryCategory.TokenCostPricingMiss };
    log.info("Desktop telemetry event received", meta);

    const callArgs = infoSpy.mock.calls[0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toBe("Desktop telemetry event received");
    expect(callArgs[1]).toBe(meta);
  });

  it("LOG_FORMAT=pretty keeps the readable form in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_FORMAT", "pretty");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const log = await importLogFresh();
    infoSpy.mockClear();

    log.info("msg", { k: "v" });

    expect(infoSpy.mock.calls[0]).toHaveLength(2);
  });

  it("production without LOG_FORMAT defaults to JSON", async () => {
    deleteEnvForTest("LOG_FORMAT");
    vi.stubEnv("NODE_ENV", "production");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const log = await importLogFresh();
    infoSpy.mockClear();

    log.info("msg", { k: "v" });

    expect(infoSpy.mock.calls[0]).toHaveLength(1);
    expect(JSON.parse(infoSpy.mock.calls[0][0] as string).k).toBe("v");
  });
});

describe("structured console preserves Error instances in meta", () => {
  it("serializes Error meta to { name, message, stack } instead of {}", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = await importLogFresh();
    errSpy.mockClear();

    log.error("sync failed", { error: new TypeError("boom") });

    const parsed = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(parsed.error.name).toBe("TypeError");
    expect(parsed.error.message).toBe("boom");
    expect(parsed.error.stack.length).toBeGreaterThan(0);
  });
});

describe("structured console redacts secrets", () => {
  const LIVE_ACCESS_TOKEN = "ya29.a0AfB_bZlFAKEtokenVALUE1234567890abcdefXYZ";

  it("scrubs a token in a string value and in an Error message", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const log = await importLogFresh();
    errSpy.mockClear();

    log.error("export failed", {
      detail: `invalid authentication credential ${LIVE_ACCESS_TOKEN}`,
      error: new Error(
        `Request failed 403: Authorization: ${LIVE_ACCESS_TOKEN}`
      ),
    });

    const line = errSpy.mock.calls[0][0] as string;
    expect(line).not.toContain("ya29.");
    const parsed = JSON.parse(line);
    expect(parsed.detail).toContain("invalid authentication");
    expect(parsed.error.message).toContain("Request failed 403");
  });
});

describe("structured console never throws on non-serializable meta", () => {
  it("falls back to the readable form when JSON.stringify throws (circular meta)", async () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const log = await importLogFresh();
    infoSpy.mockClear();

    const circular: Record<string, unknown> = { k: "v" };
    circular.self = circular;

    expect(() => log.info("circular", circular)).not.toThrow();
    const callArgs = infoSpy.mock.calls[0];
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0]).toBe("circular");
  });
});
