import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OTLP_PROXY_CONTENT_TYPE,
  OTLP_PROXY_MAX_BODY_BYTES,
} from "@repo/api/src/types/otlp-proxy";
import { createApiOtlpTelemetryTransport } from "../src/main/telemetry/api-otlp-telemetry-transport.js";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Promise<Response>): {
  calls: Call[];
  fetchImpl: typeof fetch;
} {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const BODY = new Uint8Array([1, 2, 3]);

test("posts to the proxy with bearer auth and content type only", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    Promise.resolve(new Response(null, { status: 200 }))
  );
  const transport = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test/",
    getApiKey: () => "sk_key",
    fetchImpl,
  });
  assert.equal(await transport.export("traces", BODY), true);
  assert.equal(calls[0]?.url, "https://api.test/otel/v1/traces");
  assert.deepEqual(calls[0]?.init.headers, {
    Authorization: "Bearer sk_key",
    "Content-Type": OTLP_PROXY_CONTENT_TYPE,
  });
});

test("drops oversized bodies and missing keys without a request", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    Promise.resolve(new Response(null, { status: 200 }))
  );
  const big = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => "k",
    fetchImpl,
  });
  assert.equal(
    await big.export("logs", new Uint8Array(OTLP_PROXY_MAX_BODY_BYTES + 1)),
    false
  );
  const noKey = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => null,
    fetchImpl,
  });
  assert.equal(await noKey.export("logs", BODY), false);
  assert.equal(calls.length, 0);
});

test("404 disables later exports", async () => {
  const { calls, fetchImpl } = fakeFetch(() =>
    Promise.resolve(new Response(null, { status: 404 }))
  );
  const transport = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => "k",
    fetchImpl,
  });
  assert.equal(await transport.export("traces", BODY), false);
  assert.equal(await transport.export("traces", BODY), false);
  assert.equal(calls.length, 1);
});

test("429 with Retry-After pauses until the injected clock passes", async () => {
  let clock = 1000;
  const { calls, fetchImpl } = fakeFetch(() =>
    Promise.resolve(
      new Response(null, { status: 429, headers: { "Retry-After": "2" } })
    )
  );
  const transport = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => "k",
    fetchImpl,
    now: () => clock,
  });
  await transport.export("metrics", BODY);
  clock = 2999;
  await transport.export("metrics", BODY);
  assert.equal(calls.length, 1);
  clock = 3000;
  await transport.export("metrics", BODY);
  assert.equal(calls.length, 2);
});

test("respects maxInFlight and flush resolves within drainMs while a fetch hangs", async () => {
  const { calls, fetchImpl } = fakeFetch(
    () => new Promise<Response>(() => undefined)
  );
  const transport = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => "k",
    fetchImpl,
    maxInFlight: 1,
    drainMs: 20,
  });
  transport.export("traces", BODY).catch(() => undefined);
  assert.equal(await transport.export("traces", BODY), false);
  assert.equal(calls.length, 1);
  const started = Date.now();
  await transport.flush();
  assert.ok(Date.now() - started < 1000);
});

test("network errors resolve false", async () => {
  const { fetchImpl } = fakeFetch(() => Promise.reject(new Error("down")));
  const transport = createApiOtlpTelemetryTransport({
    apiUrl: "https://api.test",
    getApiKey: () => "k",
    fetchImpl,
  });
  assert.equal(await transport.export("traces", BODY), false);
});
