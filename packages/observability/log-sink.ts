// ---------------------------------------------------------------------------
// SDK-free log-record seam.
//
// `@repo/observability/log` is imported by client components, so it must never
// import an OpenTelemetry package (same constraint as `trace-context.ts`). The
// server telemetry bootstrap registers a sink here; with none registered every
// call is inert, which is the state in every browser bundle.
// ---------------------------------------------------------------------------

import { globalSlot } from "./global-slot";
import type { LogLevel } from "./log-level";

const sinkSlot = globalSlot<LogRecordSink | undefined>(
  "log-sink",
  () => undefined
);

/** Register the process-wide sink. Called by the telemetry bootstrap only. */
export function setLogRecordSink(sink: LogRecordSink): void {
  sinkSlot.value = sink;
}

/** Clear the sink. Used by telemetry shutdown and by tests. */
export function resetLogRecordSink(): void {
  sinkSlot.value = undefined;
}

/** Whether a sink is registered. */
export function hasLogRecordSink(): boolean {
  return sinkSlot.value !== undefined;
}

/** Hand a record to the sink. Never throws; no-op without a sink. */
export function emitLogRecord(record: LogRecordInput): void {
  const sink = sinkSlot.value;
  if (!sink) {
    return;
  }
  try {
    sink(record);
  } catch {
    // Fail-open: a broken sink must not break logging.
  }
}

export type LogAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type LogAttributes = Record<string, LogAttributeValue>;

export type LogRecordInput = {
  level: LogLevel;
  message: string;
  attributes: LogAttributes;
  timestampMs: number;
};

export type LogRecordSink = (record: LogRecordInput) => void;
