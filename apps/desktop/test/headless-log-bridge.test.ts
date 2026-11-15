import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogRecord } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { createRunnerLogRecordSink } from "../src/headless/headless-log-bridge.js";
import {
  type GatewayLogMeta,
  GatewayLogSeverity,
} from "../src/main/logging/gateway-logger.js";
import {
  GatewayTraceIdKey,
  runWithGatewayTrace,
} from "../src/server/gateway-trace-context.js";

const SECRET = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

function capture() {
  const records: LogRecord[] = [];
  const sink = createRunnerLogRecordSink({
    emit: (record) => records.push(record),
  });
  const send = (meta?: GatewayLogMeta, message = "hello") =>
    sink({
      severity: GatewayLogSeverity.Warn,
      tag: "symphony-loop",
      message,
      meta,
      timestampMs: Date.now(),
    });
  return { records, send };
}

test("warn record carries severity, tag, loop id and a redacted error", () => {
  const { records, send } = capture();
  send({ loopId: "loop1", error: new Error(`boom ${SECRET}`) });
  const attributes = records[0]?.attributes ?? {};
  assert.equal(records[0]?.severityNumber, SeverityNumber.WARN);
  assert.equal(records[0]?.severityText, "WARN");
  assert.equal(attributes["af.log.tag"], "symphony-loop");
  assert.equal(attributes[GatewayTraceIdKey.LoopId], "loop1");
  assert.equal(attributes["error.name"], "Error");
  assert.ok(!String(attributes["error.message"]).includes(SECRET));
  assert.ok(String(attributes["error.message"]).includes("[REDACTED]"));
});

test("sensitive meta keys are dropped and secrets leave the body", () => {
  const { records, send } = capture();
  send({ apiKey: "abc", count: 3 }, `key ${SECRET}`);
  const attributes = records[0]?.attributes ?? {};
  assert.equal(attributes.apiKey, undefined);
  assert.equal(attributes.count, 3);
  assert.ok(!String(records[0]?.body).includes(SECRET));
});

test("ids from a gateway trace context are attached", async () => {
  const { records, send } = capture();
  await runWithGatewayTrace(
    "t",
    undefined,
    {},
    () => {
      send();
      return Promise.resolve();
    },
    { [GatewayTraceIdKey.CaseId]: "case1" }
  );
  assert.equal(records[0]?.attributes?.[GatewayTraceIdKey.CaseId], "case1");
});

test("an emit failure does not throw", () => {
  const sink = createRunnerLogRecordSink({
    emit: () => {
      throw new Error("down");
    },
  });
  assert.doesNotThrow(() =>
    sink({
      severity: GatewayLogSeverity.Info,
      tag: "t",
      message: "m",
      timestampMs: 1,
    })
  );
});
