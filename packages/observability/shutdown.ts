import { flushTelemetry } from "./tracing/hooks";

const DEFAULT_LOG_FLUSH_DEADLINE_MS = 5000;

export async function flushLogsWithDeadline(
  deadlineMs = DEFAULT_LOG_FLUSH_DEADLINE_MS
): Promise<void> {
  try {
    await Promise.race([flushTelemetry(), waitForDeadline(deadlineMs)]);
  } catch {
    // Shutdown must continue even if the logging backend is unavailable.
  }
}

export function waitForDeadline(deadlineMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, deadlineMs).unref?.();
  });
}
