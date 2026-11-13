import { AsyncLocalStorage } from "node:async_hooks";
import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { sanitizeExceptionTextField } from "../shared/exception-sanitizer.js";

export const TRACEPARENT_HEADER = "traceparent";

const TRACER_NAME = "af-runner";
const MAX_EXCEPTION_MESSAGE_LENGTH = 500;

// Duplicated on purpose from @repo/observability (the desktop app must not
// import that package): W3C traceparent, version 00, non-zero ids.
const TRACEPARENT_PATTERN =
  /^00-(?!0{32})([0-9a-f]{32})-(?!0{16})([0-9a-f]{16})-([0-9a-f]{2})$/;

type GatewayTraceStore = { traceparent: string; loopId?: string };

const storage = new AsyncLocalStorage<GatewayTraceStore>();

export function parseTraceparent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const candidate = value.trim().toLowerCase();
  return TRACEPARENT_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Runs `fn` inside a span whose parent is the inbound W3C traceparent. Without
 * a valid parent the function runs untraced. The span's traceparent is
 * available to nested code through {@link getGatewayTraceparent}.
 */
export async function runWithGatewayTrace<T>(
  name: string,
  traceparent: string | null | undefined,
  attributes: Record<string, string>,
  fn: () => Promise<T>
): Promise<T> {
  const parsed = parseTraceparent(traceparent);
  const match = parsed ? TRACEPARENT_PATTERN.exec(parsed) : null;
  if (!match) {
    return storage.exit(fn);
  }
  const remoteContext = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: match[1],
    spanId: match[2],
    traceFlags: Number.parseInt(match[3], 16),
    isRemote: true,
  });
  const span = trace
    .getTracer(TRACER_NAME)
    .startSpan(name, { attributes }, remoteContext);
  const spanContext = span.spanContext();
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  const store: GatewayTraceStore = {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`,
  };
  try {
    return await storage.run(store, () =>
      context.with(trace.setSpan(context.active(), span), fn)
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "Error";
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorName });
    span.recordException({
      name: errorName,
      message:
        sanitizeExceptionTextField(
          error instanceof Error ? error.message : String(error),
          MAX_EXCEPTION_MESSAGE_LENGTH
        ) ?? "",
    });
    throw error;
  } finally {
    span.end();
  }
}

export function getGatewayTraceparent(): string | undefined {
  return storage.getStore()?.traceparent;
}

export function annotateGatewayTrace(fields: { loopId?: string }): void {
  const store = storage.getStore();
  if (store && fields.loopId) {
    store.loopId = fields.loopId;
  }
}

export function gatewayTraceHeaders(): Record<string, string> {
  const traceparent = getGatewayTraceparent();
  return traceparent ? { [TRACEPARENT_HEADER]: traceparent } : {};
}

export function gatewayTraceEnv(): Record<string, string> {
  const store = storage.getStore();
  if (!store) {
    return {};
  }
  const env: Record<string, string> = { TRACEPARENT: store.traceparent };
  if (store.loopId) {
    env.OTEL_RESOURCE_ATTRIBUTES = `af.loop_id=${store.loopId}`;
  }
  return env;
}
