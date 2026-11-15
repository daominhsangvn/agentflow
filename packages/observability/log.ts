// ---------------------------------------------------------------------------
// Structured logger.
//
// API: same as console — log.info("msg", { key: val }), log.error(...), etc.
//
// Stdout is always written (JSON line or readable form, see
// resolveStructuredConsole). When the server telemetry bootstrap has
// registered a log-record sink (./log-sink), each call is also emitted as an
// OTel LogRecord. This module and everything it imports must NOT import any
// @opentelemetry package: it is bundled into client components.
//
// Serverless-style callers can wrap log.flush() with waitUntil() to make sure
// pending telemetry is exported before the process is torn down.
// ---------------------------------------------------------------------------

import { logJsonReplacer, toLogAttributes } from "./log-attributes";
import { LogLevel } from "./log-level";
import { emitLogRecord, hasLogRecordSink } from "./log-sink";
import { redactSensitiveText } from "./redact";
import { resolveGitSha, resolveServerVersion } from "./telemetry/context";
import { KNOWN_ORIGINS, ORIGIN, type Origin } from "./telemetry/origin";
import { getTraceContext, toLogCorrelationFields } from "./trace-context";
import { flushTelemetry } from "./tracing/hooks";

const STRUCTURED_CONSOLE = resolveStructuredConsole();
const LOG_THRESHOLD = resolveLogThreshold();
const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  [LogLevel.Debug]: 10,
  [LogLevel.Info]: 20,
  [LogLevel.Warn]: 30,
  [LogLevel.Error]: 40,
};

// If the second arg is a plain object, use it as structured meta.
// Otherwise, pack extra args into a generic "args" field.
function extractMeta(args: unknown[]): Record<string, unknown> | undefined {
  const firstArg = args[0];
  if (
    args.length === 1 &&
    typeof firstArg === "object" &&
    firstArg !== null &&
    !Array.isArray(firstArg)
  ) {
    return firstArg as Record<string, unknown>;
  }
  if (args.length > 0) {
    return { args };
  }
  return undefined;
}

// Write the console sink. In deployed runtimes emit a single JSON line so the
// stdout collector parses meta into attributes; locally keep the readable form.
// JSON.stringify can throw on circular/BigInt meta — fall back to the readable
// form so a logging call never throws.
function writeConsole(
  consoleFn: (...args: unknown[]) => void,
  level: LogLevel,
  message: string,
  args: unknown[],
  meta: Record<string, unknown> | undefined
): void {
  if (STRUCTURED_CONSOLE) {
    try {
      consoleFn(
        JSON.stringify(
          {
            ...withTraceCorrelation(meta),
            message,
            level,
            origin: resolveEntryOrigin(meta),
          },
          logJsonReplacer
        )
      );
      return;
    } catch {
      // fall through to the human-readable form below
    }
  }
  if (args.length > 0) {
    consoleFn(message, ...args);
  } else {
    consoleFn(message);
  }
}

// Hand the call to the OTel sink. The SDK-side sink attaches trace context
// from the active context, so correlation fields are not added here.
function emitToSink(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> | undefined
): void {
  if (!hasLogRecordSink()) {
    return;
  }
  try {
    emitLogRecord({
      level,
      message: redactSensitiveText(message),
      attributes: {
        ...toLogAttributes(stripCorrelationKeys(meta)),
        origin: resolveEntryOrigin(meta),
      },
      timestampMs: Date.now(),
    });
  } catch {
    // Fail-open: telemetry must never break logging.
  }
}

// Correlation comes from the active span context; callers cannot spoof it.
function stripCorrelationKeys(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) {
    return meta;
  }
  const { trace_id: _traceId, span_id: _spanId, ...rest } = meta;
  return rest;
}

function makeLogFn(
  level: LogLevel,
  consoleFn: (...args: unknown[]) => void
): (message: string, ...args: unknown[]) => void {
  return (message: string, ...args: unknown[]) => {
    if (LOG_LEVEL_RANK[level] < LOG_LEVEL_RANK[LOG_THRESHOLD]) {
      return;
    }
    const meta = extractMeta(args);
    writeConsole(consoleFn, level, message, args, meta);
    emitToSink(level, message, meta);
  };
}

// ---------------------------------------------------------------------------
// Public API — drop-in replacement for console
// ---------------------------------------------------------------------------

export const log = {
  debug: makeLogFn(LogLevel.Debug, console.debug),
  info: makeLogFn(LogLevel.Info, console.info),
  warn: makeLogFn(LogLevel.Warn, console.warn),
  error: makeLogFn(LogLevel.Error, console.error),
  /**
   * Flush pending telemetry (traces, logs, metrics). Never rejects; resolves
   * immediately when telemetry is not installed.
   */
  flush: (): Promise<void> => flushTelemetry(),
};

// Server-only diagnostics: these warnings signal a misconfigured deploy to
// ops. In client bundles (the logger is imported by client components) the
// warnings would pollute every end-user's DevTools console on page load.
if (globalThis.window === undefined) {
  if (resolveServerVersion() === "unknown") {
    log.warn("telemetry.version_fallback");
  }

  if (resolveGitSha() === "unknown") {
    log.warn("telemetry.git_sha_fallback");
  }

  const invalidLogLevel = readInvalidLogLevel();
  if (invalidLogLevel !== undefined) {
    log.warn("telemetry.log_level_invalid", { value: invalidLogLevel });
  }
}

/**
 * Stdout format (A3): JSON when `LOG_FORMAT=json`, or in production unless
 * `LOG_FORMAT=pretty`; readable otherwise.
 */
function resolveStructuredConsole(): boolean {
  const format = process.env.LOG_FORMAT;
  if (format === "json") {
    return true;
  }
  if (format === "pretty") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

/**
 * Merge the active trace's correlation ids into the stdout line's metadata.
 * Spread AFTER the caller's meta so a caller cannot spoof `trace_id`/`span_id`.
 * Returns `meta` unchanged when nothing is traced.
 */
function withTraceCorrelation(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const traceContext = getTraceContext();
  if (!traceContext) {
    return meta;
  }
  return { ...meta, ...toLogCorrelationFields(traceContext) };
}

/** A known `meta.origin` wins; otherwise the process origin. */
function resolveEntryOrigin(meta: Record<string, unknown> | undefined): Origin {
  const candidate = meta?.origin;
  if (
    typeof candidate === "string" &&
    (KNOWN_ORIGINS as readonly string[]).includes(candidate)
  ) {
    return candidate as Origin;
  }
  return ORIGIN;
}

/** True when a record at `level` would be written; skip building costly debug meta otherwise. */
export function isLogLevelEnabled(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[LOG_THRESHOLD];
}

function parseLogLevel(value: string | undefined): LogLevel | undefined {
  const normalized = value?.trim().toLowerCase();
  return (Object.values(LogLevel) as string[]).includes(normalized ?? "")
    ? (normalized as LogLevel)
    : undefined;
}

/**
 * Minimum level: `LOG_LEVEL` when valid, else info in production and debug
 * elsewhere. `process.env.LOG_LEVEL` is undefined in browsers.
 */
function resolveLogThreshold(): LogLevel {
  const configured = parseLogLevel(process.env.LOG_LEVEL);
  if (configured) {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug;
}

/** The raw `LOG_LEVEL` when it is set but not a valid level. */
function readInvalidLogLevel(): string | undefined {
  const raw = process.env.LOG_LEVEL;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  return parseLogLevel(raw) ? undefined : raw;
}
