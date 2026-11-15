// ---------------------------------------------------------------------------
// Log metadata -> flat, redacted attributes.
//
// Shared by the stdout JSON line (replacer) and the OTel log record
// (attributes). No OpenTelemetry import: `log.ts` is bundled into browsers.
// ---------------------------------------------------------------------------

import { AfAttribute } from "./af-attributes";
import type { LogAttributes, LogAttributeValue } from "./log-sink";
import { redactLogValue } from "./redact";

const MAX_FLATTEN_DEPTH = 3;

/**
 * JSON.stringify replacer. Preserves Error instances (name/message/stack) and
 * redacts secrets/PII; the expanded Error is re-visited so its fields are
 * redacted too.
 */
export function logJsonReplacer(key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return redactLogValue(key, value);
}

/** Redact and flatten caller metadata into OTel-compatible attributes. */
export function toLogAttributes(
  meta: Record<string, unknown> | undefined
): LogAttributes {
  if (!meta) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(meta, logJsonReplacer));
  } catch {
    return { "log.meta_unserializable": true };
  }
  const attributes: LogAttributes = {};
  if (isPlainObject(parsed)) {
    flattenInto(attributes, "", parsed, 1);
    addAfAliases(attributes, parsed);
  }
  return attributes;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenInto(
  target: LogAttributes,
  prefix: string,
  source: Record<string, unknown>,
  depth: number
): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && depth < MAX_FLATTEN_DEPTH) {
      flattenInto(target, path, value, depth + 1);
      continue;
    }
    const converted = toAttributeValue(value);
    if (converted !== undefined) {
      target[path] = converted;
    }
  }
}

function toAttributeValue(value: unknown): LogAttributeValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return toArrayAttribute(value);
  }
  return JSON.stringify(value);
}

function toArrayAttribute(value: unknown[]): LogAttributeValue {
  const kind = typeof value[0];
  const isPrimitiveKind =
    kind === "string" || kind === "number" || kind === "boolean";
  if (isPrimitiveKind && value.every((item) => typeof item === kind)) {
    return value as LogAttributeValue;
  }
  return JSON.stringify(value);
}

function addAfAliases(
  target: LogAttributes,
  source: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    const alias = LOG_META_AF_ALIASES[key];
    if (alias && typeof value === "string" && !(alias in target)) {
      target[alias] = value;
    }
  }
}

const LOG_META_AF_ALIASES: Record<string, string> = {
  organizationId: AfAttribute.OrgId,
  orgId: AfAttribute.OrgId,
  projectId: AfAttribute.ProjectId,
  caseId: AfAttribute.CaseId,
  taskId: AfAttribute.TaskId,
  loopId: AfAttribute.LoopId,
  runId: AfAttribute.WorkflowRunId,
  workflowRunId: AfAttribute.WorkflowRunId,
  computeTargetId: AfAttribute.ComputeTargetId,
  userId: AfAttribute.UserId,
  conversationId: AfAttribute.ConversationId,
  turnId: AfAttribute.TurnId,
  actionRunId: AfAttribute.ActionRunId,
  connectionId: AfAttribute.ConnectionId,
  commandId: AfAttribute.CommandId,
  deliveryRowId: AfAttribute.DeliveryId,
  deliveryId: AfAttribute.DeliveryId,
};
