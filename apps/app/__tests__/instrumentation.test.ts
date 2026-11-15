import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const IMPORT_START_RE = /^\s*import\s/;
const IMPORT_FROM_RE = /^\s*}\s*from\s/;
const FORBIDDEN_IMPORT_RE = /@opentelemetry|tracing\/provider/;

const mocks = vi.hoisted(() => ({
  initTelemetry: vi.fn(),
  providerLoaded: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@repo/observability/log", () => ({
  log: { info: mocks.logInfo, warn: mocks.logWarn },
}));

vi.mock("@repo/observability/tracing/provider", () => {
  mocks.providerLoaded();
  return { initTelemetry: mocks.initTelemetry };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.initTelemetry.mockReset();
  mocks.initTelemetry.mockReturnValue({
    enabled: true,
    service: "af-app",
    sampleRatio: 1,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apps/app register()", () => {
  it("initialises telemetry on the node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("../instrumentation");

    await register();

    expect(mocks.initTelemetry).toHaveBeenCalledTimes(1);
  });

  it("does not import the provider on other runtimes", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("../instrumentation");

    await register();

    expect(mocks.providerLoaded).not.toHaveBeenCalled();
    expect(mocks.initTelemetry).not.toHaveBeenCalled();
  });

  it("resolves when initTelemetry throws", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    mocks.initTelemetry.mockImplementation(() => {
      throw new Error("boom");
    });
    const { register } = await import("../instrumentation");

    await expect(register()).resolves.toBeUndefined();
  });

  it("has no static OpenTelemetry or provider import in instrumentation.ts", () => {
    const source = readFileSync(
      path.join(import.meta.dirname, "..", "instrumentation.ts"),
      "utf8"
    );
    const importLines = source
      .split("\n")
      .filter(
        (line) => IMPORT_START_RE.test(line) || IMPORT_FROM_RE.test(line)
      );

    for (const line of importLines) {
      expect(line).not.toMatch(FORBIDDEN_IMPORT_RE);
    }
  });
});
