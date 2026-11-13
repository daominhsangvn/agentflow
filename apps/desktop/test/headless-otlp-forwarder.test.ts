import assert from "node:assert/strict";
import { test } from "node:test";
import { startHeadlessOtlpForwarder } from "../src/headless/headless-otlp-forwarder.js";
import { getOtlpReceiverState } from "../src/main/telemetry/otlp-receiver-state.js";
import {
  ClaudeCodeOtelReceiverState,
  createClaudeCodeShellEnvProvider,
} from "../src/server/otel/claude-code-env.js";

const PROTOBUF = { "content-type": "application/x-protobuf" };

async function withForwarder(
  run: (port: number, calls: [string, Uint8Array][]) => Promise<void>
): Promise<void> {
  const calls: [string, Uint8Array][] = [];
  const forwarder = await startHeadlessOtlpForwarder({
    exportSignal: (signal, body) => {
      calls.push([signal, body]);
      return Promise.resolve(true);
    },
  });
  try {
    await run(forwarder.port, calls);
  } finally {
    await forwarder.stop();
  }
}

test("forwards protobuf bodies and publishes the receiver state", async () => {
  await withForwarder(async (port, calls) => {
    const state = getOtlpReceiverState();
    assert.equal(state.available, true);
    assert.equal(state.port, port);
    const response = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: "POST",
      headers: PROTOBUF,
      body: new Uint8Array([1, 2, 3]),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "logs");
    assert.deepEqual([...calls[0][1]], [1, 2, 3]);
  });
  assert.equal(getOtlpReceiverState().available, false);
});

test("rejects wrong content-type, unknown paths and oversize bodies", async () => {
  await withForwarder(async (port, calls) => {
    const base = `http://127.0.0.1:${port}`;
    const wrongType = await fetch(`${base}/v1/logs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(wrongType.status, 415);
    const unknown = await fetch(`${base}/v1/foo`, {
      method: "POST",
      headers: PROTOBUF,
      body: new Uint8Array([1]),
    });
    assert.equal(unknown.status, 404);
    const oversize = await fetch(`${base}/v1/traces`, {
      method: "POST",
      headers: PROTOBUF,
      body: new Uint8Array(600 * 1024),
    });
    assert.equal(oversize.status, 413);
    assert.equal(calls.length, 0);
  });
});

test("envOverrides apply only when the receiver is ready", async () => {
  const overrides = { OTEL_SERVICE_NAME: "af-claude-code" };
  const base = () => Promise.resolve({ OTEL_SERVICE_NAME: "af-runner" });
  const ready = createClaudeCodeShellEnvProvider({
    getReceiverStatus: () => ({
      state: ClaudeCodeOtelReceiverState.Ready,
      host: "127.0.0.1",
      port: 4318,
    }),
    getBaseShellEnv: base,
    envOverrides: overrides,
  });
  const unavailable = createClaudeCodeShellEnvProvider({
    getReceiverStatus: () => ({
      state: ClaudeCodeOtelReceiverState.Unavailable,
      reason: "otlp_receiver_not_started",
    }),
    getBaseShellEnv: base,
    envOverrides: overrides,
  });
  assert.equal((await ready()).OTEL_SERVICE_NAME, "af-claude-code");
  assert.equal((await unavailable()).OTEL_SERVICE_NAME, "af-runner");
});
