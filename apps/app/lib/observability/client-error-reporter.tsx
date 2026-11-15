"use client";

import {
  ClientErrorKind,
  ClientErrorLevel,
  type ClientErrorRecord,
} from "@repo/api/src/types/client-errors";
import { useApiClient } from "@repo/app/shared/api/use-api-client";
import { log } from "@repo/observability/log";
import {
  type LogRecordInput,
  resetLogRecordSink,
  setLogRecordSink,
} from "@repo/observability/log-sink";
import { useEffect, useRef } from "react";

const DEDUPE_WINDOW_MS = 60_000;
const MAX_RECORDS_PER_PAGE_SESSION = 50;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_BATCH_SIZE = 10;
const UNHANDLED_MESSAGE = "client.unhandled_error";
const REJECTION_MESSAGE = "client.unhandled_rejection";
const REPORT_ENDPOINT = "/client-errors";

export function ClientErrorReporter(): null {
  const api = useApiClient();
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const queue: ClientErrorRecord[] = [];
    const lastSeen = new Map<string, number>();
    let accepted = 0;

    const flush = () => {
      if (queue.length === 0) {
        return;
      }
      const records = queue.splice(0, queue.length);
      for (let i = 0; i < records.length; i += FLUSH_BATCH_SIZE * 2) {
        apiRef.current
          .post(REPORT_ENDPOINT, {
            records: records.slice(i, i + FLUSH_BATCH_SIZE * 2),
          })
          .catch(() => {
            // observability: reporter cannot report its own delivery failure
          });
      }
    };

    const sink = (record: LogRecordInput) => {
      const converted = toClientErrorRecord(record);
      if (!converted || accepted >= MAX_RECORDS_PER_PAGE_SESSION) {
        return;
      }
      const now = Date.now();
      const previous = lastSeen.get(converted.message);
      if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) {
        return;
      }
      lastSeen.set(converted.message, now);
      accepted += 1;
      queue.push(converted);
      if (queue.length >= FLUSH_BATCH_SIZE) {
        flush();
      }
    };

    const onError = (event: ErrorEvent) => {
      log.error(UNHANDLED_MESSAGE, { error: event.error ?? event.message });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      log.error(REJECTION_MESSAGE, { error: event.reason });
    };

    setLogRecordSink(sink);
    globalThis.addEventListener("error", onError);
    globalThis.addEventListener("unhandledrejection", onRejection);
    const timer = globalThis.setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      globalThis.removeEventListener("error", onError);
      globalThis.removeEventListener("unhandledrejection", onRejection);
      globalThis.clearInterval(timer);
      resetLogRecordSink();
      flush();
    };
  }, []);

  return null;
}

function toClientErrorRecord(record: LogRecordInput): ClientErrorRecord | null {
  if (
    record.level !== ClientErrorLevel.Error &&
    record.level !== ClientErrorLevel.Warn
  ) {
    return null;
  }
  const attributes = record.attributes;
  const name = readString(attributes["error.name"]);
  const errorMessage =
    readString(attributes["error.message"]) ?? readString(attributes.error);
  const stack = readString(attributes["error.stack"]);
  return {
    kind: resolveKind(record.message),
    level: record.level,
    message: (errorMessage ?? record.message).slice(0, 1024),
    name: name?.slice(0, 200),
    stack: stack?.slice(0, 4096),
    path: globalThis.location.pathname.slice(0, 512),
  };
}

function resolveKind(message: string): ClientErrorKind {
  if (message === UNHANDLED_MESSAGE) {
    return ClientErrorKind.Unhandled;
  }
  if (message === REJECTION_MESSAGE) {
    return ClientErrorKind.Rejection;
  }
  return ClientErrorKind.Log;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
