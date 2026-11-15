/**
 * Structured logger for the desktop gateway.
 * All log entries are timestamped, tagged by subsystem, and optionally
 * buffered in-memory so the UI can display recent entries.
 */

import { SECRET_VALUE_REPLACE_PATTERN } from "@agentflow-ai/loops-api/secret-value-pattern";
import { isBrokenPipeError } from "../../shared/broken-pipe.js";
import { EMAIL_VALUE_PATTERN } from "../../shared/exception-sanitizer.js";
import { writeGatewayLogEntry } from "./persistent-log.js";

export type LogLevel = "info" | "warn" | "error";
export type LogSession = "current" | "previous";
export type LogMessageFactory = string | (() => string);

/**
 * The console surface {@link GatewayLogger} tees to. Injected so the EPIPE
 * shutdown path (ISS-5089) is drivable in a test without touching the real
 * process streams.
 */
export type ConsoleSink = Pick<Console, "log" | "warn" | "error">;

/**
 * The two process output streams `console.*` writes through. `console.log` goes
 * to stdout; `console.warn`/`console.error` go to stderr. They fail
 * INDEPENDENTLY — a piped stdout can close while stderr is still a live
 * terminal — so ISS-5089 latches egress per channel, not per process.
 */
export const ConsoleChannel = {
  Stdout: "stdout",
  Stderr: "stderr",
} as const;
export type ConsoleChannel =
  (typeof ConsoleChannel)[keyof typeof ConsoleChannel];

/**
 * Minimal shape of the process streams the console writes through. Only the
 * error-listener surface is needed, so a plain `EventEmitter` satisfies it in
 * tests without standing up a real socket.
 */
export type ConsoleStream = {
  on: (event: "error", listener: (error: unknown) => void) => unknown;
};

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  tag: string;
  message: string;
  session?: LogSession;
};

const MAX_BUFFER_SIZE = 500;

export class GatewayLogger {
  private verbose = false;
  private readonly buffer: LogEntry[] = [];
  private onChange?: (entries: LogEntry[]) => void;
  private lastMessage = "";
  /**
   * ISS-5089: the console channels proven gone (EPIPE on shutdown), latched per
   * CHANNEL. A closed pipe never reopens, so we stop attempting egress on it
   * rather than throwing a fresh EPIPE per entry — but only on the dead one:
   * `desktop-dev | head` closes stdout while stderr is still a live terminal, so
   * a single process-wide latch would blind the operator to every warning and
   * error for the rest of the run. The persistent sink and the in-memory buffer
   * keep working either way, so nothing is lost — only the tee to a stream that
   * no longer exists.
   */
  private readonly closedChannels = new Set<ConsoleChannel>();
  /**
   * ISS-5089: set once the durable sink has failed, so the one-shot diagnostic
   * below is emitted once rather than per entry.
   */
  private persistentSinkFailed = false;
  private threshold: GatewayLogSeverity;
  private recordSink?: GatewayLogRecordSink;
  private recordSinkFailed = false;

  constructor(
    private readonly persistentSink = writeGatewayLogEntry,
    private readonly consoleSink: ConsoleSink = console,
    env: NodeJS.ProcessEnv = process.env
  ) {
    this.threshold = resolveGatewayLogThreshold(env);
  }

  /** Minimum severity that reaches the console and the record sink. */
  setThreshold(severity: GatewayLogSeverity): void {
    this.threshold = severity;
  }

  /** Receives every record that passed the threshold, with its real severity and meta. */
  setRecordSink(sink: GatewayLogRecordSink | undefined): void {
    this.recordSink = sink;
    this.recordSinkFailed = false;
  }

  /**
   * ISS-5089: stop teeing to one console channel (or both, by default). Called
   * by {@link installConsoleStreamErrorGuard} the moment a process stream
   * reports a broken pipe, and idempotent so repeated shutdown signals are free.
   */
  closeConsoleEgress(channel?: ConsoleChannel): void {
    if (channel) {
      this.closedChannels.add(channel);
      return;
    }
    this.closedChannels.add(ConsoleChannel.Stdout);
    this.closedChannels.add(ConsoleChannel.Stderr);
  }

  /** Visible for the ISS-5089 regression test and shutdown diagnostics. */
  isConsoleEgressClosed(channel?: ConsoleChannel): boolean {
    if (channel) {
      return this.closedChannels.has(channel);
    }
    return (
      this.closedChannels.has(ConsoleChannel.Stdout) &&
      this.closedChannels.has(ConsoleChannel.Stderr)
    );
  }

  setVerbose(enabled: boolean): void {
    if (this.verbose === enabled) {
      return;
    }
    this.verbose = enabled;
    this.info(
      "logger",
      enabled ? "Verbose logging enabled" : "Verbose logging disabled"
    );
  }

  isVerbose(): boolean {
    return this.verbose;
  }

  setOnChange(cb: (entries: LogEntry[]) => void): void {
    this.onChange = cb;
  }

  info(tag: string, message: string, meta?: GatewayLogMeta): void {
    this.log("info", GatewayLogSeverity.Info, tag, message, meta);
  }

  warn(tag: string, message: string, meta?: GatewayLogMeta): void {
    this.log("warn", GatewayLogSeverity.Warn, tag, message, meta);
  }

  error(tag: string, message: string, meta?: GatewayLogMeta): void {
    this.log("error", GatewayLogSeverity.Error, tag, message, meta);
  }

  /** Verbose or LOG_LEVEL=debug only -- skipped without invoking lazy formatting when off. */
  debug(tag: string, message: LogMessageFactory, meta?: GatewayLogMeta): void {
    if (!this.verbose && this.threshold !== GatewayLogSeverity.Debug) {
      return;
    }
    this.log(
      "info",
      GatewayLogSeverity.Debug,
      tag,
      typeof message === "function" ? message() : message,
      meta
    );
  }

  getEntries(): LogEntry[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
    this.lastMessage = "";
    this.notifyChange([]);
  }

  seedPreviousSessionEntries(entries: LogEntry[]): void {
    if (entries.length === 0) {
      return;
    }

    const previousEntries = entries.map((entry) => ({
      ...entry,
      session: "previous" as const,
    }));
    this.buffer.push(...previousEntries);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }
    this.notifyChange([...this.buffer]);
  }

  private log(
    level: LogLevel,
    severity: GatewayLogSeverity,
    tag: string,
    message: string,
    meta?: GatewayLogMeta
  ): void {
    const key = `${level}:${tag}:${message}`;
    if (key === this.lastMessage) {
      return;
    }
    this.lastMessage = key;

    const now = new Date();
    const ts = now.toISOString();
    const entry: LogEntry = {
      timestamp: ts,
      level,
      tag,
      message,
      session: "current",
    };

    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    const short = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
    const prefix = `[${tag}][${short}]`;
    const rank = GATEWAY_LOG_SEVERITY_RANK[severity];
    if (
      (this.verbose && severity === GatewayLogSeverity.Debug) ||
      rank >= GATEWAY_LOG_SEVERITY_RANK[this.threshold]
    ) {
      this.writeToConsole(level, prefix, message, meta);
      this.writeToRecordSink({
        severity,
        tag,
        message,
        meta,
        timestampMs: now.getTime(),
      });
    }

    this.writeToPersistentSink(entry);
    this.notifyChange([...this.buffer]);
  }

  /**
   * ISS-5089: write the durable record. A failing sink (disk full, closed file
   * handle, a dead `electron-log` transport) must not take down the logging
   * caller, and must NOT be re-reported through `this.log`, which would recurse.
   * But it must not vanish either — every entry silently dropping forever is
   * exactly the swallowed-bad-state the repo's bad-data rule forbids — so the
   * first failure is announced once, straight at the console sink.
   */
  private writeToPersistentSink(entry: LogEntry): void {
    try {
      this.persistentSink(entry);
    } catch (error: unknown) {
      if (this.persistentSinkFailed) {
        return;
      }
      this.persistentSinkFailed = true;
      const reason = error instanceof Error ? error.message : String(error);
      this.writeToConsole(
        "error",
        "[logger]",
        `persistent log sink failed; entries are in-memory only: ${reason}`
      );
    }
  }

  private writeToRecordSink(record: GatewayLogRecord): void {
    if (!this.recordSink) {
      return;
    }
    try {
      this.recordSink(record);
    } catch (error: unknown) {
      if (this.recordSinkFailed) {
        return;
      }
      this.recordSinkFailed = true;
      // observability: logger cannot log its own sink failure
      const reason = error instanceof Error ? error.message : String(error);
      this.writeToConsole(
        "error",
        "[logger]",
        `log record sink failed; records are not exported: ${reason}`
      );
    }
  }

  /** Notify the renderer. A failing callback is not the logging caller's problem. */
  private notifyChange(entries: LogEntry[]): void {
    try {
      this.onChange?.(entries);
    } catch {
      // Deliberately swallowed: see writeToPersistentSink for why this cannot
      // route back through `this.log`.
    }
  }

  /**
   * ISS-5089: best-effort console tee. `console.*` can throw `EPIPE` (or
   * `ERR_STREAM_DESTROYED`) once the terminal that owned stdout/stderr has gone
   * away — which is exactly what happens on Ctrl-C during `just desktop-dev`,
   * and in any packaged or supervised launch whose output pipe closes first.
   * Swallowing it here is what keeps a normal shutdown from being recorded as
   * an application crash by the global uncaught-exception handler (which itself
   * logs through this class, so an unguarded throw here recurses).
   */
  private writeToConsole(
    level: LogLevel,
    prefix: string,
    message: string,
    meta?: GatewayLogMeta
  ): void {
    const channel =
      level === "info" ? ConsoleChannel.Stdout : ConsoleChannel.Stderr;
    if (this.closedChannels.has(channel)) {
      return;
    }
    const line = meta ? `${message}${summarizeMeta(meta)}` : message;
    try {
      if (level === "error") {
        this.consoleSink.error(prefix, line);
      } else if (level === "warn") {
        this.consoleSink.warn(prefix, line);
      } else {
        this.consoleSink.log(prefix, line);
      }
    } catch (error: unknown) {
      if (isBrokenPipeError(error)) {
        this.closedChannels.add(channel);
      }
      // Any other console failure stays best-effort for this entry only; the
      // durable record is unaffected either way.
    }
  }
}

// Declared before the singleton below, whose constructor reads them.
export const GatewayLogSeverity = {
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
} as const;
export type GatewayLogSeverity =
  (typeof GatewayLogSeverity)[keyof typeof GatewayLogSeverity];

const GATEWAY_LOG_SEVERITY_RANK: Record<GatewayLogSeverity, number> = {
  [GatewayLogSeverity.Debug]: 0,
  [GatewayLogSeverity.Info]: 1,
  [GatewayLogSeverity.Warn]: 2,
  [GatewayLogSeverity.Error]: 3,
};

/** Singleton instance shared across the app. */
export const gatewayLog = new GatewayLogger();

const NETWORK_ERROR_RE =
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i;

/** Returns true when the message looks like a transient network failure. */
export function isNetworkError(message: string): boolean {
  return NETWORK_ERROR_RE.test(message);
}

/**
 * ISS-5089: make console egress survive a closed output pipe.
 *
 * Node's global `console` already swallows a SYNCHRONOUS write error, but for
 * a pipe (which is what `just desktop-dev` gives stdout) the failure arrives
 * ASYNCHRONOUSLY on the stream's own `error` event — after console removed
 * the temporary no-op listener it installs only when the stream has none. With
 * no listener left, Node raises it as an uncaught exception, which the desktop
 * error handler then records as an application crash 14ms into an entirely
 * expected shutdown.
 *
 * Attaching a durable listener closes that window twice over: it handles the
 * async error itself, and because the stream now permanently has an `error`
 * listener, Node's console stops adding/removing its own.
 *
 * A broken pipe latches egress off for THAT CHANNEL on `logger`, so we stop
 * writing into a dead stream without blinding the other one. Anything else is
 * recorded through the logger, whose persistent sink still works — never
 * swallowed silently.
 *
 * Idempotent per stream via {@link guardedStreams}, so repeated wiring in tests
 * or a re-entered bootstrap cannot stack listeners.
 */
export function installConsoleStreamErrorGuard(
  streams: { channel: ConsoleChannel; stream: ConsoleStream }[],
  logger: GatewayLogger = gatewayLog
): void {
  for (const { channel, stream } of streams) {
    if (guardedStreams.has(stream)) {
      continue;
    }
    guardedStreams.add(stream);
    stream.on("error", (error: unknown) => {
      if (isBrokenPipeError(error)) {
        logger.closeConsoleEgress(channel);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("logger", `${channel} stream error: ${message}`);
    });
  }
}

/** Streams already carrying the ISS-5089 guard, so wiring stays idempotent. */
const guardedStreams = new WeakSet<ConsoleStream>();

export type GatewayLogMeta = Record<string, unknown>;

export type GatewayLogRecord = {
  severity: GatewayLogSeverity;
  tag: string;
  message: string;
  meta?: GatewayLogMeta;
  timestampMs: number;
};

export type GatewayLogRecordSink = (record: GatewayLogRecord) => void;

/** A valid `LOG_LEVEL` (case-insensitive), else info: the runner has no NODE_ENV. */
export function resolveGatewayLogThreshold(
  env: NodeJS.ProcessEnv
): GatewayLogSeverity {
  const value = env.LOG_LEVEL?.trim().toLowerCase();
  const match = Object.values(GatewayLogSeverity).find(
    (severity) => severity === value
  );
  return match ?? GatewayLogSeverity.Info;
}

const CONSOLE_REDACTED_TEXT = "[REDACTED]";
// Global twin of the sanitizer's email pattern (it is declared non-global).
const CONSOLE_EMAIL_PATTERN = new RegExp(EMAIL_VALUE_PATTERN.source, "g");

function redactConsoleText(text: string): string {
  return text
    .replaceAll(SECRET_VALUE_REPLACE_PATTERN, CONSOLE_REDACTED_TEXT)
    .replaceAll(CONSOLE_EMAIL_PATTERN, `$1${CONSOLE_REDACTED_TEXT}`);
}

/** Console suffix: `...Id` string values, `reason`, and `error` as "name: message". */
function summarizeMeta(meta: GatewayLogMeta): string {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value instanceof Error) {
      if (key === "error") {
        summary.error = redactConsoleText(`${value.name}: ${value.message}`);
      }
    } else if (
      typeof value === "string" &&
      (key.endsWith("Id") || key === "reason")
    ) {
      summary[key] = value;
    }
  }
  if (Object.keys(summary).length === 0) {
    return "";
  }
  try {
    return ` ${JSON.stringify(summary)}`;
  } catch {
    // observability: logger cannot log its own meta serialization failure
    return "";
  }
}
