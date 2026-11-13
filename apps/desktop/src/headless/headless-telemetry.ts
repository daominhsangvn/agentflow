import {
  type AnyValueMap,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import type { KeylessTelemetrySignal } from "@repo/shared-platform/keyless-telemetry";
import { gatewayLog } from "../main/logging/gateway-logger.js";
import { createApiOtlpTelemetryTransport } from "../main/telemetry/api-otlp-telemetry-transport.js";
import {
  createDesktopOtelRuntime,
  type DesktopOtelRuntime,
} from "../main/telemetry/app-otel-runtime.js";
import {
  DesktopAppLifecycleEvent,
  DesktopAppOperatingMode,
} from "../main/telemetry/app-otel-runtime-lifecycle.js";
import type { DesktopTelemetryTransport } from "../main/telemetry/relay-telemetry-transport.js";
import type {
  TelemetryEmitter,
  TelemetryEventPayload,
  TelemetrySeverity,
} from "../main/telemetry/telemetry-protocol.js";
import { BUILD_APP_VERSION } from "../shared/build-info.js";
import type { HeadlessRunnerConfig } from "./headless-config.js";

const LOG_TAG = "headless-telemetry";
export const RUNNER_SERVICE_NAME = "af-runner";
const RUNNER_LOGGER_NAME = "af-runner";
const MESSAGE_MAX_LENGTH = 1024;
const SHUTDOWN_TIMEOUT_MS = 3000;

/** Attribute keys; the desktop does not depend on `@repo/observability`. */
export const RunnerTelemetryAttribute = {
  Category: "af.telemetry.category",
  ComputeTargetId: "af.compute_target_id",
  LoopId: "af.loop_id",
  CommandId: "af.command_id",
  OperationId: "af.operation_id",
  JobId: "af.job_id",
} as const;

export type HeadlessTelemetry = {
  emitter: TelemetryEmitter;
  /** Set only when telemetry is enabled; ships a raw OTLP body via the sanctioned transport. */
  exportSignal?: (
    signal: KeylessTelemetrySignal,
    body: Uint8Array
  ) => Promise<boolean>;
  stop(): Promise<void>;
};

const SEVERITY_NUMBERS: Record<TelemetrySeverity, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export function startHeadlessTelemetry(input: {
  config: HeadlessRunnerConfig;
  gatewayId: string;
  env?: NodeJS.ProcessEnv;
  transport?: DesktopTelemetryTransport;
}): HeadlessTelemetry {
  if (!input.config.telemetry) {
    return {
      emitter: { emit: () => undefined },
      stop: () => Promise.resolve(),
    };
  }
  const env = input.env ?? process.env;
  const { config, gatewayId } = input;
  const transport =
    input.transport ??
    createApiOtlpTelemetryTransport({
      apiUrl: config.apiUrl,
      getApiKey: () => config.apiKey,
    });
  const runtime = createDesktopOtelRuntime({
    appVersion: BUILD_APP_VERSION,
    env,
    serviceName: env.OTEL_SERVICE_NAME ?? RUNNER_SERVICE_NAME,
    getAppInstallationId: () => gatewayId,
    isPackaged: false,
    telemetryTransport: transport,
  });
  let started = false;
  const ready = runtime
    .start()
    .then(() => {
      started = true;
      runtime.emitAppLifecycleEvent({
        event: DesktopAppLifecycleEvent.Start,
        operatingMode: DesktopAppOperatingMode.Multiplayer,
      });
    })
    .catch((error: unknown) => {
      gatewayLog.warn(
        LOG_TAG,
        `Runner telemetry failed to start: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  return {
    emitter: { emit: emitLogRecord },
    exportSignal: (signal, body) => transport.export(signal, body),
    stop: () => stopRuntime(runtime, ready, () => started),
  };
}

async function stopRuntime(
  runtime: DesktopOtelRuntime,
  ready: Promise<void>,
  isStarted: () => boolean
): Promise<void> {
  try {
    await ready;
    if (!isStarted()) {
      return;
    }
    runtime.emitAppLifecycleEvent({
      event: DesktopAppLifecycleEvent.Shutdown,
      operatingMode: DesktopAppOperatingMode.Multiplayer,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delay = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([runtime.shutdown(), delay]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Best-effort telemetry never affects the caller.
  }
}

function emitLogRecord(event: TelemetryEventPayload): void {
  try {
    logs.getLogger(RUNNER_LOGGER_NAME).emit({
      severityNumber: SEVERITY_NUMBERS[event.severity],
      severityText: event.severity,
      body: event.message.slice(0, MESSAGE_MAX_LENGTH),
      attributes: buildAttributes(event),
    });
  } catch {
    // Best-effort telemetry never affects the caller.
  }
}

function buildAttributes(event: TelemetryEventPayload): AnyValueMap {
  const trace = event.trace;
  const attributes: AnyValueMap = {
    [RunnerTelemetryAttribute.Category]: event.category,
  };
  const ids: [string, string | undefined][] = [
    [RunnerTelemetryAttribute.ComputeTargetId, trace?.computeTargetId],
    [RunnerTelemetryAttribute.LoopId, trace?.loopId],
    [RunnerTelemetryAttribute.CommandId, trace?.commandId],
    [RunnerTelemetryAttribute.OperationId, trace?.operationId],
    [RunnerTelemetryAttribute.JobId, trace?.jobId],
  ];
  for (const [key, value] of ids) {
    if (value) {
      attributes[key] = value;
    }
  }
  return attributes;
}
