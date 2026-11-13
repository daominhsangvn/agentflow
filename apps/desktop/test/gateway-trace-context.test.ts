import assert from "node:assert/strict";
import { test } from "node:test";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { parseDesktopCommand } from "../src/main/cloud/cloud-socket-payloads.js";
import {
  gatewayTraceEnv,
  gatewayTraceHeaders,
  getGatewayTraceparent,
  parseTraceparent,
  runWithGatewayTrace,
} from "../src/server/gateway-trace-context.js";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const TP = `00-${TRACE_ID}-b7ad6b7169203331-01`;

test("passes the inbound traceparent through without an SDK", async () => {
  const seen = await runWithGatewayTrace("t", TP, {}, async () =>
    getGatewayTraceparent()
  );
  assert.equal(seen, TP);
  assert.equal(getGatewayTraceparent(), undefined);
});

test("no parent means no trace context", async () => {
  await runWithGatewayTrace("t", undefined, {}, () => {
    assert.deepEqual(gatewayTraceHeaders(), {});
    assert.deepEqual(gatewayTraceEnv(), {});
    return Promise.resolve();
  });
});

test("keeps the traceId with a new spanId and records ERROR on rejection", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  try {
    const seen = await runWithGatewayTrace("ok", TP, {}, async () =>
      getGatewayTraceparent()
    );
    assert.ok(seen);
    assert.ok(seen.includes(`-${TRACE_ID}-`));
    assert.notEqual(seen, TP);

    await assert.rejects(
      runWithGatewayTrace("bad", TP, {}, () => {
        return Promise.reject(new Error("boom"));
      })
    );
    const failed = exporter.getFinishedSpans().find((s) => s.name === "bad");
    assert.equal(failed?.status.code, SpanStatusCode.ERROR);
  } finally {
    trace.disable();
    await provider.shutdown();
  }
});

test("parseTraceparent rejects garbage", () => {
  assert.equal(parseTraceparent("nope"), null);
  assert.equal(parseTraceparent(42), null);
  assert.equal(
    parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01"),
    null
  );
  assert.equal(parseTraceparent(TP), TP);
});

test("parseDesktopCommand keeps a valid traceparent and drops an invalid one", () => {
  const base = {
    commandId: "c1",
    operationId: "op",
    method: "GET",
    path: "/api/gateway/health-check",
  };
  assert.equal(
    parseDesktopCommand({ ...base, traceparent: TP })?.traceparent,
    TP
  );
  assert.equal(
    parseDesktopCommand({ ...base, traceparent: "bad" })?.traceparent,
    undefined
  );
});
