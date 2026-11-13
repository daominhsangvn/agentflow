import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEnvForTest } from "../../__tests__/test-helpers";
import {
  resolveSampleRatio,
  resolveTelemetryConfig,
  TelemetryDisabledReason,
} from "../config";

const ENDPOINT = "http://localhost:4318";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Clear every input this module reads, so each test starts from a known floor. */
function clearOtelEnv(): void {
  deleteEnvForTest(
    "OTEL_SDK_DISABLED",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "OTEL_TRACES_SAMPLER",
    "OTEL_TRACES_SAMPLER_ARG"
  );
}

describe("resolveTelemetryConfig", () => {
  it("is disabled when OTEL_SDK_DISABLED is truthy, even if configured", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    vi.stubEnv("OTEL_SDK_DISABLED", "TRUE");
    expect(resolveTelemetryConfig()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.ExplicitlyDisabled,
    });
  });

  it("is disabled without an endpoint", () => {
    clearOtelEnv();
    expect(resolveTelemetryConfig()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.MissingEndpoint,
    });
  });

  it("treats an empty-string endpoint as missing", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
    expect(resolveTelemetryConfig()).toEqual({
      enabled: false,
      reason: TelemetryDisabledReason.MissingEndpoint,
    });
  });

  it("returns the enabled shape", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    vi.stubEnv("OTEL_SERVICE_NAME", "af-api");
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "0.5");
    expect(resolveTelemetryConfig()).toEqual({
      enabled: true,
      endpoint: ENDPOINT,
      service: "af-api",
      sampleRatio: 0.5,
    });
  });

  it("falls back to af-unknown for the service name", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", ENDPOINT);
    const config = resolveTelemetryConfig();
    expect(config.enabled && config.service).toBe("af-unknown");
  });
});

describe("resolveSampleRatio", () => {
  it("defaults to 1", () => {
    clearOtelEnv();
    expect(resolveSampleRatio()).toBe(1);
  });

  it("falls back to 1 for a malformed value", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "1oops");
    expect(resolveSampleRatio()).toBe(1);
  });

  it("clamps above 1 and below 0", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "5");
    expect(resolveSampleRatio()).toBe(1);
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "-2");
    expect(resolveSampleRatio()).toBe(0);
  });

  it("returns 0 for always_off", () => {
    clearOtelEnv();
    vi.stubEnv("OTEL_TRACES_SAMPLER", "always_off");
    vi.stubEnv("OTEL_TRACES_SAMPLER_ARG", "1");
    expect(resolveSampleRatio()).toBe(0);
  });
});
