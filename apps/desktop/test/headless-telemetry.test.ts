import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import type { HeadlessRunnerConfig } from "../src/headless/headless-config.js";
import { startHeadlessTelemetry } from "../src/headless/headless-telemetry.js";
import type { DesktopTelemetryTransport } from "../src/main/telemetry/relay-telemetry-transport.js";

afterEach(() => {
  trace.disable();
  metrics.disable();
  logs.disable();
});

function makeTransport() {
  const exported: Array<{ signal: string; body: Uint8Array }> = [];
  const transport: DesktopTelemetryTransport = {
    start: () => undefined,
    stop: () => undefined,
    flush: () => Promise.resolve(),
    export: (signal, body) => {
      exported.push({ signal, body: Uint8Array.from(body) });
      return Promise.resolve(true);
    },
  };
  return { exported, transport };
}

function configWith(telemetry: boolean): HeadlessRunnerConfig {
  return {
    apiUrl: "https://api.test",
    apiKey: "k",
    telemetry,
  } as unknown as HeadlessRunnerConfig;
}

test("disabled config never exports", async () => {
  const { exported, transport } = makeTransport();
  const telemetry = startHeadlessTelemetry({
    config: configWith(false),
    gatewayId: "gw",
    transport,
  });
  telemetry.emitter.emit({
    severity: "info",
    category: "command.timeout",
    message: "x",
  });
  await telemetry.stop();
  assert.equal(exported.length, 0);
});

test("enabled config exports a lifecycle span as af-runner on stop", async () => {
  const { exported, transport } = makeTransport();
  const telemetry = startHeadlessTelemetry({
    config: configWith(true),
    gatewayId: "gw",
    env: {},
    transport,
  });
  await telemetry.stop();
  const traces = exported.filter((e) => e.signal === "traces");
  assert.ok(traces.length > 0);
  assert.ok(
    traces.some((e) => Buffer.from(e.body).includes("af-runner")),
    "service.name af-runner reaches the resource"
  );
});

test("emitter maps ids and drops diagnostics", async () => {
  const { exported, transport } = makeTransport();
  const telemetry = startHeadlessTelemetry({
    config: configWith(true),
    gatewayId: "gw",
    env: {},
    transport,
  });
  // Let the async runtime start register its logger provider.
  await new Promise((resolve) => setImmediate(resolve));
  telemetry.emitter.emit({
    severity: "warn",
    category: "command.timeout",
    message: "boom",
    trace: { computeTargetId: "ct_1", loopId: "loop_9" },
    diagnostics: { secretTail: "SECRET_LOG_TAIL" } as never,
  });
  await telemetry.stop();
  const bytes = Buffer.concat(
    exported.filter((e) => e.signal === "logs").map((e) => Buffer.from(e.body))
  );
  assert.ok(bytes.includes("af.compute_target_id"));
  assert.ok(bytes.includes("ct_1"));
  assert.ok(bytes.includes("af.loop_id"));
  assert.ok(bytes.includes("WARN"));
  assert.ok(!bytes.includes("SECRET_LOG_TAIL"));
});
