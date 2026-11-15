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
  annotateGatewayTrace,
  BAGGAGE_HEADER,
  GatewayTraceIdKey,
  gatewayTraceBaggageHeaders,
  gatewayTraceEnv,
  gatewayTraceHeaders,
  getGatewayTraceparent,
  parseAfBaggage,
  parseTraceparent,
  runWithGatewayTrace,
  setGatewayStaticTraceIds,
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

test("ids from baggage reach OTEL_RESOURCE_ATTRIBUTES and the baggage header", async () => {
  const ids = parseAfBaggage("af.case_id=c1,af.task_id=t1");
  await runWithGatewayTrace(
    "t",
    TP,
    {},
    () => {
      const env = gatewayTraceEnv();
      assert.ok(env.TRACEPARENT);
      assert.equal(env.OTEL_RESOURCE_ATTRIBUTES, "af.case_id=c1,af.task_id=t1");
      assert.deepEqual(
        parseAfBaggage(gatewayTraceBaggageHeaders()[BAGGAGE_HEADER]),
        ids
      );
      return Promise.resolve();
    },
    ids
  );
});

test("static compute target id is merged and annotate adds ids", async () => {
  setGatewayStaticTraceIds({ [GatewayTraceIdKey.ComputeTargetId]: "ct1" });
  try {
    await runWithGatewayTrace(
      "t",
      TP,
      {},
      () => {
        annotateGatewayTrace({ caseId: "c2", loopId: "bad value" });
        const attrs = gatewayTraceEnv().OTEL_RESOURCE_ATTRIBUTES ?? "";
        assert.ok(attrs.includes("af.compute_target_id=ct1"));
        assert.ok(attrs.includes("af.case_id=c2"));
        assert.ok(!attrs.includes("af.loop_id"));
        return Promise.resolve();
      },
      {}
    );
  } finally {
    setGatewayStaticTraceIds({});
  }
});

test("invalid baggage values and unknown keys are dropped", () => {
  assert.deepEqual(
    parseAfBaggage("af.case_id=ok,af.task_id=a b,evil=x,af.loop_id=a%2Cb"),
    { [GatewayTraceIdKey.CaseId]: "ok" }
  );
  assert.deepEqual(parseAfBaggage("x".repeat(600)), {});
  assert.deepEqual(parseAfBaggage(42), {});
});

test("ids without a traceparent still label the env, without TRACEPARENT", async () => {
  await runWithGatewayTrace(
    "t",
    undefined,
    {},
    () => {
      const env = gatewayTraceEnv();
      assert.equal(env.TRACEPARENT, undefined);
      assert.equal(env.OTEL_RESOURCE_ATTRIBUTES, "af.case_id=c1");
      return Promise.resolve();
    },
    { [GatewayTraceIdKey.CaseId]: "c1" }
  );
});

test("parseDesktopCommand keeps a bounded baggage string and drops the rest", () => {
  const base = {
    commandId: "c1",
    operationId: "op",
    method: "GET",
    path: "/api/gateway/health-check",
  };
  assert.equal(
    parseDesktopCommand({ ...base, baggage: "af.case_id=c1,af.task_id=t1" })
      ?.baggage,
    "af.case_id=c1,af.task_id=t1"
  );
  assert.equal(
    parseDesktopCommand({ ...base, baggage: "x".repeat(513) })?.baggage,
    undefined
  );
  assert.equal(
    parseDesktopCommand({ ...base, baggage: "" })?.baggage,
    undefined
  );
});
