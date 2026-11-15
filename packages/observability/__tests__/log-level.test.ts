import { afterEach, describe, expect, it, vi } from "vitest";
import { LogLevel } from "../log-level";
import { type LogRecordInput, resetLogRecordSink } from "../log-sink";
import { deleteEnvForTest } from "./test-helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetLogRecordSink();
  vi.resetModules();
});

async function setup() {
  const records: LogRecordInput[] = [];
  const spies = {
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  };
  vi.resetModules();
  const mod = await import("../log");
  const sink = await import("../log-sink");
  sink.setLogRecordSink((record) => {
    records.push(record);
  });
  for (const spy of Object.values(spies)) {
    spy.mockClear();
  }
  return { ...mod, records, spies };
}

describe("LOG_LEVEL", () => {
  it("warn drops info on both sinks and keeps warn", async () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    const { log, records, spies } = await setup();
    log.info("dropped");
    expect(spies.info).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
    log.warn("kept");
    expect(spies.warn).toHaveBeenCalledOnce();
    expect(records.map((r) => r.message)).toEqual(["kept"]);
  });

  it("is case-insensitive and trimmed", async () => {
    vi.stubEnv("LOG_LEVEL", " WARN ");
    const { isLogLevelEnabled } = await setup();
    expect(isLogLevelEnabled(LogLevel.Info)).toBe(false);
    expect(isLogLevelEnabled(LogLevel.Warn)).toBe(true);
  });

  it("defaults to info in production", async () => {
    deleteEnvForTest("LOG_LEVEL");
    vi.stubEnv("NODE_ENV", "production");
    const { log, spies } = await setup();
    log.debug("dropped");
    log.info("kept");
    expect(spies.debug).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledOnce();
  });

  it("defaults to debug in development", async () => {
    deleteEnvForTest("LOG_LEVEL");
    vi.stubEnv("NODE_ENV", "development");
    const { log, spies } = await setup();
    log.debug("kept");
    expect(spies.debug).toHaveBeenCalledOnce();
  });

  it("falls back to the default for an invalid value", async () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    vi.stubEnv("NODE_ENV", "production");
    const { isLogLevelEnabled } = await setup();
    expect(isLogLevelEnabled(LogLevel.Debug)).toBe(false);
    expect(isLogLevelEnabled(LogLevel.Info)).toBe(true);
  });

  it("isLogLevelEnabled follows the threshold", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const { isLogLevelEnabled } = await setup();
    expect(isLogLevelEnabled(LogLevel.Warn)).toBe(false);
    expect(isLogLevelEnabled(LogLevel.Error)).toBe(true);
  });
});
