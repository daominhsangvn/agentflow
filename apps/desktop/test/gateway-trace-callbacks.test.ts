import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  annotateGatewayTrace,
  runWithGatewayTrace,
} from "../src/server/gateway-trace-context.js";
import { postLoopEvent } from "../src/server/operations/loop-http.js";
import { getShellEnv } from "../src/server/shell-path.js";

const TP = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const LOOP_ID = "11111111-2222-4333-8444-555555555555";

const originalFetch = globalThis.fetch;
const originalServiceName = process.env.OTEL_SERVICE_NAME;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalServiceName === undefined) {
    delete process.env.OTEL_SERVICE_NAME;
  } else {
    process.env.OTEL_SERVICE_NAME = originalServiceName;
  }
});

function stubFetch(): { headers: () => Record<string, string> } {
  let captured: Record<string, string> = {};
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    captured = { ...(init?.headers as Record<string, string>) };
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { headers: () => captured };
}

test("postLoopEvent forwards traceparent inside a gateway trace", async () => {
  const stub = stubFetch();
  await runWithGatewayTrace("t", TP, {}, () =>
    postLoopEvent("http://api.test", LOOP_ID, () => "tok", { type: "x" })
  );
  assert.equal(stub.headers().traceparent, TP);
});

test("postLoopEvent sends no traceparent outside a gateway trace", async () => {
  const stub = stubFetch();
  await postLoopEvent("http://api.test", LOOP_ID, () => "tok", { type: "x" });
  assert.equal(stub.headers().traceparent, undefined);
});

test("getShellEnv carries the trace and drops OTEL_SERVICE_NAME", async () => {
  process.env.OTEL_SERVICE_NAME = "af-runner";
  const env = await runWithGatewayTrace("t", TP, {}, () => {
    annotateGatewayTrace({ loopId: LOOP_ID });
    return getShellEnv();
  });
  assert.equal(env.TRACEPARENT, TP);
  assert.ok(env.OTEL_RESOURCE_ATTRIBUTES?.includes(`af.loop_id=${LOOP_ID}`));
  assert.equal(env.OTEL_SERVICE_NAME, undefined);
});
