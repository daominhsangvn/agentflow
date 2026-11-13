import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { isSensitiveKey, redactSensitiveText } from "./redact";

const TRACER_NAME = "@repo/observability";

export const AfAttribute = {
  OrgId: "af.org_id",
  ProjectId: "af.project_id",
  CaseId: "af.case_id",
  TaskId: "af.task_id",
  LoopId: "af.loop_id",
  WorkflowRunId: "af.workflow_run_id",
  ComputeTargetId: "af.compute_target_id",
  UserId: "af.user_id",
} as const;
export type AfAttribute = (typeof AfAttribute)[keyof typeof AfAttribute];

export type SpanAttributes = Record<
  string,
  string | number | boolean | undefined
>;

export function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T> | T
): Promise<T> {
  return trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(
      name,
      { attributes: sanitizeSpanAttributes(attributes) },
      async (span) => {
        try {
          return await fn(span);
        } catch (error) {
          recordError(error, span);
          throw error;
        } finally {
          span.end();
        }
      }
    );
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
    const safe = new Error(redactSensitiveText(source.message));
    safe.name = source.name;
    safe.stack = redactSensitiveText(source.stack ?? "");
    span.recordException(safe);
    span.setStatus({ code: SpanStatusCode.ERROR, message: source.name });
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
