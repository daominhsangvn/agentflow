import assert from "node:assert/strict";
import { test } from "node:test";
import { createHeadlessClaudeCodeOtel } from "../src/headless/headless-claude-code-otel.js";
import {
  annotateGatewayTrace,
  runWithGatewayTrace,
} from "../src/server/gateway-trace-context.js";
import { createClaudeCodeShellEnvProvider } from "../src/server/otel/claude-code-env.js";

const TRACEPARENT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

function claudeEnv(
  otel: ReturnType<typeof createHeadlessClaudeCodeOtel>
): Promise<Record<string, string>> {
  const provider = createClaudeCodeShellEnvProvider({
    getReceiverStatus: otel.serverOptions.getClaudeCodeOtelReceiverStatus,
    envOverrides: otel.serverOptions.claudeCodeOtelEnvOverrides,
  });
  return runWithGatewayTrace("test", TRACEPARENT, {}, () => {
    annotateGatewayTrace({ loopId: "loop-1" });
    return provider();
  });
}

test("claude env gets the forwarder endpoint once it listens, not before", async () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://runner-collector:4318";
  process.env.OTEL_LOG_USER_PROMPTS = "1";
  const otel = createHeadlessClaudeCodeOtel(() => Promise.resolve(true));
  try {
    const before = await claudeEnv(otel);
    assert.equal(before.CLAUDE_CODE_ENABLE_TELEMETRY, undefined);

    const forwarder = await otel.start();
    assert.ok(forwarder);
    try {
      const env = await claudeEnv(otel);
      assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, "1");
      assert.equal(
        env.OTEL_EXPORTER_OTLP_ENDPOINT,
        `http://127.0.0.1:${forwarder.port}`
      );
      assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, "http/protobuf");
      assert.equal(env.OTEL_METRICS_EXPORTER, "otlp");
      assert.equal(env.OTEL_LOGS_EXPORTER, "otlp");
      assert.equal(env.OTEL_SERVICE_NAME, "af-claude-code");
      assert.equal(env.OTEL_LOG_USER_PROMPTS, "0");
      assert.equal(env.OTEL_LOG_TOOL_CONTENT, "0");
      assert.equal(env.TRACEPARENT?.startsWith("00-0af765"), true);
      assert.ok(env.OTEL_RESOURCE_ATTRIBUTES?.includes("af.loop_id=loop-1"));
    } finally {
      await forwarder.stop();
    }
    const after = await claudeEnv(otel);
    assert.equal(after.CLAUDE_CODE_ENABLE_TELEMETRY, undefined);
  } finally {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_LOG_USER_PROMPTS;
  }
});

test("telemetry off: no forwarder and no injection", async () => {
  const otel = createHeadlessClaudeCodeOtel(undefined);
  assert.equal(await otel.start(), null);
  const env = await claudeEnv(otel);
  assert.equal(env.CLAUDE_CODE_ENABLE_TELEMETRY, undefined);
});
