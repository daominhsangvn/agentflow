import { SECRET_VALUE_REPLACE_PATTERN } from "@agentflow-ai/loops-api/secret-value-pattern";
import { context } from "@opentelemetry/api";
import {
  type AnyValueMap,
  type LogRecord,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";
import {
  type GatewayLogMeta,
  type GatewayLogRecord,
  type GatewayLogRecordSink,
  GatewayLogSeverity,
} from "../main/logging/gateway-logger.js";
import {
  GatewayTraceIdKey,
  type GatewayTraceIds,
  getGatewayTraceIds,
} from "../server/gateway-trace-context.js";
import { EMAIL_VALUE_PATTERN } from "../shared/exception-sanitizer.js";

const RUNNER_LOGGER_NAME = "af-runner";
const MAX_BODY_LENGTH = 4096;
const MAX_STACK_LENGTH = 4096;
const REDACTED_TEXT = "[REDACTED]";

export const RunnerLogAttribute = {
  Tag: "af.log.tag",
  CommandId: "af.command_id",
  OperationId: "af.operation_id",
  ErrorName: "error.name",
  ErrorMessage: "error.message",
  ErrorStack: "error.stack",
} as const;

const SEVERITY_NUMBERS: Record<GatewayLogSeverity, SeverityNumber> = {
  [GatewayLogSeverity.Debug]: SeverityNumber.DEBUG,
  [GatewayLogSeverity.Info]: SeverityNumber.INFO,
  [GatewayLogSeverity.Warn]: SeverityNumber.WARN,
  [GatewayLogSeverity.Error]: SeverityNumber.ERROR,
};

const SENSITIVE_META_KEY =
  /(token|secret|password|authorization|cookie|api[_-]?key|credential)/i;

/** camelCase meta keys that become `af.*` attributes. */
const META_ID_KEYS: Record<string, string> = {
  loopId: GatewayTraceIdKey.LoopId,
  caseId: GatewayTraceIdKey.CaseId,
  taskId: GatewayTraceIdKey.TaskId,
  turnId: GatewayTraceIdKey.TurnId,
  workflowRunId: GatewayTraceIdKey.WorkflowRunId,
  projectId: GatewayTraceIdKey.ProjectId,
  organizationId: GatewayTraceIdKey.OrgId,
  computeTargetId: GatewayTraceIdKey.ComputeTargetId,
  commandId: RunnerLogAttribute.CommandId,
  operationId: RunnerLogAttribute.OperationId,
};

// Global twin of the sanitizer's email pattern (it is declared non-global).
const EMAIL_REPLACE_PATTERN = new RegExp(EMAIL_VALUE_PATTERN.source, "g");

/**
 * Turns runner log records into OTel log records. The active span (the
 * `runner.command` or `gateway.request` span) gives each record its trace and
 * span ids. Secrets and emails are replaced; file paths are kept on purpose
 * (they stay in the operator's own backend).
 */
export function createRunnerLogRecordSink(deps?: {
  getIds?: () => GatewayTraceIds;
  emit?: (record: LogRecord) => void;
}): GatewayLogRecordSink {
  const getIds = deps?.getIds ?? getGatewayTraceIds;
  const emit =
    deps?.emit ??
    ((record: LogRecord) => logs.getLogger(RUNNER_LOGGER_NAME).emit(record));
  return (record: GatewayLogRecord) => {
    try {
      emit({
        severityNumber: SEVERITY_NUMBERS[record.severity],
        severityText: record.severity.toUpperCase(),
        body: redactText(record.message).slice(0, MAX_BODY_LENGTH),
        attributes: buildAttributes(record, getIds()),
        timestamp: record.timestampMs,
        context: context.active(),
      });
    } catch {
      // observability: telemetry bridge must not log its own failure
    }
  };
}

function redactText(text: string): string {
  return text
    .replaceAll(SECRET_VALUE_REPLACE_PATTERN, REDACTED_TEXT)
    .replaceAll(EMAIL_REPLACE_PATTERN, `$1${REDACTED_TEXT}`);
}

function buildAttributes(
  record: GatewayLogRecord,
  ids: GatewayTraceIds
): AnyValueMap {
  const attributes: AnyValueMap = { [RunnerLogAttribute.Tag]: record.tag };
  for (const [key, value] of Object.entries(ids)) {
    attributes[key] = value;
  }
  if (record.meta) {
    addMetaAttributes(attributes, record.meta);
  }
  return attributes;
}

function addMetaAttributes(
  attributes: AnyValueMap,
  meta: GatewayLogMeta
): void {
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEY.test(key)) {
      continue;
    }
    if (value instanceof Error) {
      addErrorAttributes(attributes, value);
    } else if (typeof value === "string") {
      attributes[META_ID_KEYS[key] ?? key] = redactText(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      attributes[META_ID_KEYS[key] ?? key] = value;
    }
  }
}

function addErrorAttributes(attributes: AnyValueMap, error: Error): void {
  attributes[RunnerLogAttribute.ErrorName] = error.name;
  attributes[RunnerLogAttribute.ErrorMessage] = redactText(error.message);
  if (error.stack) {
    attributes[RunnerLogAttribute.ErrorStack] = redactText(
      error.stack.slice(0, MAX_STACK_LENGTH)
    );
  }
}
