import {
  type Context,
  isSpanContextValid,
  ROOT_CONTEXT,
  type Span,
  type SpanContext,
  SpanStatusCode,
  type TraceFlags,
  trace,
} from "@opentelemetry/api";
import { AfAttribute, AfOutcome } from "./af-attributes";
import { isSensitiveKey, redactSensitiveText } from "./redact";

const TRACER_NAME = "@repo/observability";
const TRACEPARENT_PATTERN = /^00-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const MAX_REASON_LENGTH = 256;
const MAX_STATUS_MESSAGE_LENGTH = 512;

export type SpanAttributes = Record<
  string,
  string | number | boolean | undefined
>;

export type SpanStartOptions = {
  parent?: string;
  root?: boolean;
  links?: readonly (string | null | undefined)[];
};

export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T> | T,
  options?: SpanStartOptions
): Promise<T> {
  const run = async (span: Span): Promise<T> => {
    try {
      return await fn(span);
    } catch (error) {
      recordError(error, span);
      throw error;
    } finally {
      span.end();
    }
  };
  const spanOptions = {
    attributes: sanitizeSpanAttributes(attributes),
    ...(options?.root ? { root: true } : {}),
    ...buildLinks(options?.links),
  };
  const tracer = trace.getTracer(TRACER_NAME);
  const parentContext = buildParentContext(options?.parent);
  if (parentContext) {
    return tracer.startActiveSpan(name, spanOptions, parentContext, run);
  }
  return tracer.startActiveSpan(name, spanOptions, run);
}

export function getActiveTraceparent(): string | undefined {
  try {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!(spanContext && isSpanContextValid(spanContext))) {
      return undefined;
    }
    const flags = Number(spanContext.traceFlags).toString(16).padStart(2, "0");
    return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
  } catch {
    return undefined;
  }
}

export function setSpanOutcome(
  outcome: AfOutcome,
  reason?: string,
  span: Span | undefined = trace.getActiveSpan()
): void {
  if (!span) {
    return;
  }
  try {
    span.setAttribute(AfAttribute.Outcome, outcome);
    if (
      outcome === AfOutcome.Error ||
      outcome === AfOutcome.Retry ||
      outcome === AfOutcome.Rejected
    ) {
      const message = redactSensitiveText(reason ?? "error").slice(
        0,
        MAX_REASON_LENGTH
      );
      span.setAttribute(AfAttribute.ErrorReason, message);
      if (outcome === AfOutcome.Error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message });
      }
    }
  } catch {
    // Telemetry must never throw.
  }
}

function parseTraceparent(
  value: string | null | undefined
): SpanContext | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = TRACEPARENT_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, traceId, spanId, flags] = match;
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) {
    return null;
  }
  return {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16) as TraceFlags,
    isRemote: true,
  };
}

function buildParentContext(parent: string | undefined): Context | undefined {
  try {
    const parsed = parseTraceparent(parent);
    return parsed ? trace.setSpanContext(ROOT_CONTEXT, parsed) : undefined;
  } catch {
    return undefined;
  }
}

function buildLinks(links: SpanStartOptions["links"]): {
  links?: { context: SpanContext }[];
} {
  if (!links) {
    return {};
  }
  const result: { context: SpanContext }[] = [];
  for (const link of links) {
    const context = parseTraceparent(link);
    if (context) {
      result.push({ context });
    }
  }
  return result.length > 0 ? { links: result } : {};
}

export function recordError(
  error: unknown,
  span: Span | undefined = trace.getActiveSpan()
): void {
  if (!span) {
    return;
  }
  try {
    const source = error instanceof Error ? error : new Error(String(error));
    const safeMessage = redactSensitiveText(source.message);
    const safe = new Error(safeMessage);
    safe.name = source.name;
    safe.stack = redactSensitiveText(source.stack ?? "");
    span.recordException(safe);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `${source.name}: ${safeMessage}`.slice(
        0,
        MAX_STATUS_MESSAGE_LENGTH
      ),
    });
  } catch {
    // Telemetry must never throw.
  }
}

function sanitizeSpanAttributes(
  attributes: SpanAttributes
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || isSensitiveKey(key)) {
      continue;
    }
    result[key] =
      typeof value === "string" ? redactSensitiveText(value) : value;
  }
  return result;
}

export function setActiveSpanAttributes(attributes: SpanAttributes): void {
  try {
    const span = trace.getActiveSpan();
    if (!span) {
      return;
    }
    span.setAttributes(sanitizeSpanAttributes(attributes));
  } catch {
    // Telemetry must never throw.
  }
}

/** Adds a named event (sanitized attributes) to the active span. */
export function addActiveSpanEvent(
  name: string,
  attributes: SpanAttributes = {}
): void {
  try {
    trace.getActiveSpan()?.addEvent(name, sanitizeSpanAttributes(attributes));
  } catch {
    // Telemetry must never throw.
  }
}

export function runInLinkedSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: () => Promise<T>
): Promise<T> {
  let started: Promise<T>;
  let invoked = false;
  try {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const parent =
      spanContext && isSpanContextValid(spanContext) ? spanContext : undefined;
    started = trace.getTracer(TRACER_NAME).startActiveSpan(
      name,
      {
        root: true,
        links: parent ? [{ context: parent }] : [],
        attributes: sanitizeSpanAttributes(attributes),
      },
      async (span) => {
        try {
          invoked = true;
          return await fn();
        } catch (error) {
          recordError(error, span);
          throw error;
        } finally {
          span.end();
        }
      }
    );
  } catch {
    // Fail open, but never run the work twice and always hand back a promise,
    // so a synchronous throw reaches the caller's rejection handling.
    return invoked
      ? Promise.reject(new Error("span setup failed"))
      : (async () => fn())();
  }
  return started;
}

export function markSpanError(span: Span, message?: string): void {
  try {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message:
        message === undefined
          ? undefined
          : redactSensitiveText(message).slice(0, MAX_STATUS_MESSAGE_LENGTH),
    });
  } catch {
    // Telemetry must never throw.
  }
}
