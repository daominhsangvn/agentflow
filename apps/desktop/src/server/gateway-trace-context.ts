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

type GatewayTraceStore = { traceparent?: string; ids: GatewayTraceIds };

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
  fn: () => Promise<T>,
  ids: GatewayTraceIds = {}
): Promise<T> {
  const parsed = parseTraceparent(traceparent);
  const match = parsed ? TRACEPARENT_PATTERN.exec(parsed) : null;
  if (!match) {
    if (Object.keys(ids).length === 0) {
      return storage.exit(fn);
    }
    // No trace to join, but the ids still label logs and spawned CLIs.
    return storage.run({ ids: { ...ids } }, fn);
  }
  const remoteContext = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: match[1],
    spanId: match[2],
    traceFlags: Number.parseInt(match[3], 16),
    isRemote: true,
  });
  const span = trace
    .getTracer(TRACER_NAME)
    .startSpan(name, { attributes: { ...attributes, ...ids } }, remoteContext);
  const spanContext = span.spanContext();
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");
  const store: GatewayTraceStore = {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`,
    ids: { ...ids },
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

export function gatewayTraceHeaders(): Record<string, string> {
  const traceparent = getGatewayTraceparent();
  return traceparent ? { [TRACEPARENT_HEADER]: traceparent } : {};
}

export function gatewayTraceEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const traceparent = getGatewayTraceparent();
  if (traceparent) {
    env.TRACEPARENT = traceparent;
  }
  const resourceAttributes = Object.entries(getGatewayTraceIds())
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  if (resourceAttributes) {
    env.OTEL_RESOURCE_ATTRIBUTES = resourceAttributes;
  }
  return env;
}

export const GatewayTraceIdKey = {
  OrgId: "af.org_id",
  ProjectId: "af.project_id",
  CaseId: "af.case_id",
  TaskId: "af.task_id",
  TurnId: "af.turn_id",
  LoopId: "af.loop_id",
  WorkflowRunId: "af.workflow_run_id",
  ComputeTargetId: "af.compute_target_id",
  ConversationId: "af.conversation_id",
} as const;
export type GatewayTraceIdKey =
  (typeof GatewayTraceIdKey)[keyof typeof GatewayTraceIdKey];

export type GatewayTraceIds = Partial<Record<GatewayTraceIdKey, string>>;

export const BAGGAGE_HEADER = "baggage";

// Duplicated on purpose from @repo/observability (af-baggage.ts; the desktop
// app must not import that package): same allow-list, value pattern and cap.
const MAX_BAGGAGE_LENGTH = 512;
const AF_ID_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const GATEWAY_TRACE_ID_KEYS: readonly GatewayTraceIdKey[] =
  Object.values(GatewayTraceIdKey);

let staticIds: GatewayTraceIds = {};

/** Parse a baggage string into ids. Unknown keys, bad values and over-length input are dropped. */
export function parseAfBaggage(value: unknown): GatewayTraceIds {
  const ids: GatewayTraceIds = {};
  if (typeof value !== "string" || value.length > MAX_BAGGAGE_LENGTH) {
    return ids;
  }
  for (const member of value.split(",")) {
    const pair = member.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = GATEWAY_TRACE_ID_KEYS.find(
      (candidate) => candidate === pair.slice(0, separator).trim()
    );
    const decoded = decodeBaggageValue(pair.slice(separator + 1).trim());
    if (key && decoded !== undefined && AF_ID_VALUE_PATTERN.test(decoded)) {
      ids[key] = decoded;
    }
  }
  return ids;
}

/** `k=v` pairs joined by `,`; undefined when empty or over 512 chars. */
export function formatAfBaggage(ids: GatewayTraceIds): string | undefined {
  const parts: string[] = [];
  for (const key of GATEWAY_TRACE_ID_KEYS) {
    const value = ids[key];
    if (value !== undefined && AF_ID_VALUE_PATTERN.test(value)) {
      parts.push(`${key}=${value}`);
    }
  }
  const baggage = parts.join(",");
  if (baggage === "" || baggage.length > MAX_BAGGAGE_LENGTH) {
    return undefined;
  }
  return baggage;
}

/** Ids that apply to the whole runner process (the compute target id). */
export function setGatewayStaticTraceIds(ids: GatewayTraceIds): void {
  staticIds = { ...ids };
}

export function getGatewayTraceIds(): GatewayTraceIds {
  return { ...staticIds, ...storage.getStore()?.ids };
}

export type GatewayTraceAnnotation = {
  loopId?: string;
  caseId?: string;
  taskId?: string;
  turnId?: string;
  workflowRunId?: string;
  projectId?: string;
  orgId?: string;
};

const ANNOTATION_KEYS: Record<keyof GatewayTraceAnnotation, GatewayTraceIdKey> =
  {
    loopId: GatewayTraceIdKey.LoopId,
    caseId: GatewayTraceIdKey.CaseId,
    taskId: GatewayTraceIdKey.TaskId,
    turnId: GatewayTraceIdKey.TurnId,
    workflowRunId: GatewayTraceIdKey.WorkflowRunId,
    projectId: GatewayTraceIdKey.ProjectId,
    orgId: GatewayTraceIdKey.OrgId,
  };

/** Add ids discovered mid-request to the store and the active span. */
export function annotateGatewayTrace(fields: GatewayTraceAnnotation): void {
  const store = storage.getStore();
  for (const [field, key] of Object.entries(ANNOTATION_KEYS)) {
    const value = fields[field as keyof GatewayTraceAnnotation];
    if (value === undefined || !AF_ID_VALUE_PATTERN.test(value)) {
      continue;
    }
    if (store) {
      store.ids[key] = value;
    }
    trace.getActiveSpan()?.setAttribute(key, value);
  }
}

/** `baggage` header for requests that hand the current ids to the in-process gateway. */
export function gatewayTraceBaggageHeaders(): Record<string, string> {
  const baggage = formatAfBaggage(storage.getStore()?.ids ?? {});
  return baggage ? { [BAGGAGE_HEADER]: baggage } : {};
}

function decodeBaggageValue(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    // observability: telemetry — a malformed baggage value is dropped
    return undefined;
  }
}
