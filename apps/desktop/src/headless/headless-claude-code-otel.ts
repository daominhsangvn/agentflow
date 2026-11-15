import type { KeylessTelemetrySignal } from "@repo/shared-platform/keyless-telemetry";
import { gatewayLog } from "../main/logging/gateway-logger.js";
import {
  getOtlpReceiverState,
  toClaudeCodeOtelReceiverStatus,
} from "../main/telemetry/otlp-receiver-state.js";
import {
  ClaudeCodeOtelEnvVar,
  type ClaudeCodeOtelReceiverStatus,
} from "../server/otel/claude-code-env.js";
import {
  type HeadlessOtlpForwarder,
  startHeadlessOtlpForwarder,
} from "./headless-otlp-forwarder.js";

const LOG_TAG = "headless-claude-code-otel";

export type HeadlessClaudeCodeOtel = {
  /** Options for `DesktopGatewayServer` so spawned `claude` processes export to the forwarder. */
  serverOptions: {
    getClaudeCodeOtelReceiverStatus: () => ClaudeCodeOtelReceiverStatus;
    claudeCodeOtelEnvOverrides: Record<string, string>;
  };
  /** Starts the loopback forwarder; null when telemetry is off or the bind failed. */
  start(): Promise<HeadlessOtlpForwarder | null>;
};

/**
 * Wires Claude Code telemetry in the headless runner. The receiver status the
 * env injection reads is the process-wide one the forwarder publishes when it
 * listens. The endpoint, protocol and exporters are forced (not merely
 * defaulted) so an OTEL_* value inherited by the runner process, such as its
 * own collector endpoint, never redirects Claude Code's telemetry.
 */
export function createHeadlessClaudeCodeOtel(
  exportSignal:
    | ((signal: KeylessTelemetrySignal, body: Uint8Array) => Promise<boolean>)
    | undefined
): HeadlessClaudeCodeOtel {
  const claudeCodeOtelEnvOverrides: Record<string, string> = {
    ...CLAUDE_CODE_OTEL_ENV_OVERRIDES,
  };
  return {
    serverOptions: {
      getClaudeCodeOtelReceiverStatus: () =>
        toClaudeCodeOtelReceiverStatus(getOtlpReceiverState()),
      claudeCodeOtelEnvOverrides,
    },
    start: async () => {
      if (!exportSignal) {
        return null;
      }
      try {
        const forwarder = await startHeadlessOtlpForwarder({ exportSignal });
        claudeCodeOtelEnvOverrides[ClaudeCodeOtelEnvVar.OtlpEndpoint] =
          `http://127.0.0.1:${forwarder.port}`;
        return forwarder;
      } catch (error) {
        gatewayLog.warn(
          LOG_TAG,
          `Claude Code OTLP forwarder failed to start: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }
    },
  };
}

/** Claude Code telemetry labels: its own service name and slower export cadence. */
const CLAUDE_CODE_OTEL_ENV_OVERRIDES: Record<string, string> = {
  [ClaudeCodeOtelEnvVar.EnableTelemetry]: "1",
  [ClaudeCodeOtelEnvVar.MetricsExporter]: "otlp",
  [ClaudeCodeOtelEnvVar.LogsExporter]: "otlp",
  // The forwarder accepts application/x-protobuf only.
  [ClaudeCodeOtelEnvVar.OtlpProtocol]: "http/protobuf",
  OTEL_SERVICE_NAME: "af-claude-code",
  OTEL_LOGS_EXPORT_INTERVAL: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
  // Content switches stay off whatever the operator's profile sets, so prompt
  // text, tool arguments/output and raw API bodies never reach SigNoz.
  OTEL_LOG_USER_PROMPTS: "0",
  OTEL_LOG_TOOL_DETAILS: "0",
  OTEL_LOG_TOOL_CONTENT: "0",
  OTEL_LOG_RAW_API_BODIES: "0",
};
