/**
 * Loop-scoped log helpers (shared with symphony-loop.ts). Every record carries
 * `{ loopId }` as meta so the OTel log bridge can label it.
 */
import { inspect } from "node:util";
import { gatewayLog } from "../../main/logging/gateway-logger.js";

const LOOP_LOG_TAG = "symphony-loop";

type LoopLogLevel = "info" | "warn" | "error";

export const loopLog = (loopId: string, ...args: unknown[]): void =>
  loopEmit("info", loopId, formatLoopLogArgs(args));

export const loopWarn = (loopId: string, ...args: unknown[]): void =>
  loopEmit("warn", loopId, formatLoopLogArgs(args));

export const loopError = (loopId: string, ...args: unknown[]): void =>
  loopEmit("error", loopId, formatLoopLogArgs(args));

export const loopDebug = (loopId: string, message: () => string): void =>
  gatewayLog.debug(LOOP_LOG_TAG, () => `[${loopId.slice(0, 8)}] ${message()}`, {
    loopId,
  });

function loopEmit(level: LoopLogLevel, loopId: string, text: string): void {
  gatewayLog[level](LOOP_LOG_TAG, `[${loopId.slice(0, 8)}] ${text}`, {
    loopId,
  });
}

function formatLoopLogArgs(args: unknown[]): string {
  return args
    .map((arg) =>
      typeof arg === "string"
        ? arg
        : inspect(arg, { depth: 4, breakLength: 120 })
    )
    .join(" ");
}
