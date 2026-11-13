import { afterEach, describe, expect, it, vi } from "vitest";
import { Origin } from "../telemetry/origin";

// ---------------------------------------------------------------------------
// ORIGIN — module-load-time resolution from OTEL_SERVICE_NAME
// ---------------------------------------------------------------------------
//
// Origin is a pure const object safe to import statically; ORIGIN requires
// dynamic re-import after vi.resetModules() so each test gets a fresh
// module evaluation with the stubbed env.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ORIGIN — known OTEL_SERVICE_NAME values", () => {
  it("resolves to Origin.Desktop when OTEL_SERVICE_NAME=desktop", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "desktop");
    const mod = await import("../telemetry/origin");
    expect(mod.ORIGIN).toBe(Origin.Desktop);
  });

  it("resolves to Origin.Api when OTEL_SERVICE_NAME=api", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "api");
    const mod = await import("../telemetry/origin");
    expect(mod.ORIGIN).toBe(Origin.Api);
  });

  it("resolves to Origin.Relay when OTEL_SERVICE_NAME=relay", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "relay");
    const mod = await import("../telemetry/origin");
    expect(mod.ORIGIN).toBe(Origin.Relay);
  });

  it("resolves to Origin.Mcp when OTEL_SERVICE_NAME=mcp", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "mcp");
    const mod = await import("../telemetry/origin");
    expect(mod.ORIGIN).toBe(Origin.Mcp);
  });
});

describe("ORIGIN — fallback to Unknown with console.warn", () => {
  it("resolves to Origin.Unknown and warns when OTEL_SERVICE_NAME is unset", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", undefined as unknown as string);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });

  it("resolves to Origin.Unknown and warns when OTEL_SERVICE_NAME is an off-whitelist value", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "bogus");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });
});

describe("ORIGIN — cl-* prefixed OTEL_SERVICE_NAME happy paths", () => {
  it.each([
    ["af-api", Origin.Api],
    ["af-relay", Origin.Relay],
    ["af-desktop", Origin.Desktop],
    ["af-mcp", Origin.Mcp],
  ] as [
    string,
    Origin,
  ][])("resolves %s to %s without warning", async (ddServiceValue, expected) => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", ddServiceValue);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(expected);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("ORIGIN — cl-* prefixed OTEL_SERVICE_NAME fallback/edge cases", () => {
  it("resolves af-bogus to Origin.Unknown and warns", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "af-bogus");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });

  it("resolves cl- (empty suffix) to Origin.Unknown and warns", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "af-");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });

  it("resolves af-cl-api to Origin.Unknown and warns", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "af-cl-api");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });

  // Cross-PR composition guard: PLN-384's "af-unknown" sentinel must NOT
  // promote to a known origin via prefix-stripping. "unknown" is filtered
  // out of KNOWN_ORIGINS (origin.ts:21), so it correctly falls through.
  it("resolves af-unknown to Origin.Unknown and warns", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "af-unknown");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await import("../telemetry/origin");

    expect(mod.ORIGIN).toBe(Origin.Unknown);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(parseWarnLine(warnSpy.mock.calls[0][0])).toMatchObject(
      ORIGIN_FALLBACK_LINE
    );
  });
});

describe("ORIGIN — immutability after module load", () => {
  it("does not change when process.env.OTEL_SERVICE_NAME is mutated after import", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_SERVICE_NAME", "api");
    const mod = await import("../telemetry/origin");
    const capturedOrigin = mod.ORIGIN;

    // Mutate the env after the module has already been evaluated
    vi.stubEnv("OTEL_SERVICE_NAME", "desktop");

    // ORIGIN is a module-level const — mutation after load must have no effect
    expect(mod.ORIGIN).toBe(capturedOrigin);
    expect(mod.ORIGIN).toBe(Origin.Api);
  });
});

/**
 * The platform drain JSON-parses this line into attributes, so the fields are
 * asserted on the parsed object rather than by scanning the raw string.
 * Severity is a literal here because origin.ts cannot import `LogLevel` from
 * ../log — that import cycle is why it writes to console.warn at all.
 */
const ORIGIN_FALLBACK_LINE = {
  event: "telemetry.origin_fallback",
  level: "warn",
} as const;

function parseWarnLine(line: unknown): Record<string, unknown> {
  if (typeof line !== "string") {
    throw new Error(`expected a single JSON string arg, got ${typeof line}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
}
