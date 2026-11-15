import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitLogRecord,
  hasLogRecordSink,
  type LogRecordInput,
  resetLogRecordSink,
  setLogRecordSink,
} from "../log-sink";

const record: LogRecordInput = {
  level: "info",
  message: "hello",
  attributes: { a: 1 },
  timestampMs: 1,
};

afterEach(() => {
  resetLogRecordSink();
});

describe("log-sink", () => {
  it("is inert without a sink", () => {
    expect(hasLogRecordSink()).toBe(false);
    expect(() => emitLogRecord(record)).not.toThrow();
  });

  it("delivers records to the registered sink", () => {
    const sink = vi.fn();
    setLogRecordSink(sink);
    expect(hasLogRecordSink()).toBe(true);
    emitLogRecord(record);
    expect(sink).toHaveBeenCalledWith(record);
  });

  it("swallows sink exceptions", () => {
    setLogRecordSink(() => {
      throw new Error("boom");
    });
    expect(() => emitLogRecord(record)).not.toThrow();
  });

  it("reset clears the sink", () => {
    setLogRecordSink(vi.fn());
    resetLogRecordSink();
    expect(hasLogRecordSink()).toBe(false);
  });
});
