// SDK-free helpers for the `af.*` ids that travel as a W3C baggage string.
// Imported by apps/api and browser-reachable code: must not import `@opentelemetry/*`.

import { AfAttribute } from "./af-attributes";

const MAX_BAGGAGE_LENGTH = 512;
const AF_ID_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type AfIds = Partial<Record<AfAttribute, string>>;

/** Id keys that become resource attributes. No per-command ids (too many distinct values). */
export const AF_ID_ATTRIBUTES: readonly AfAttribute[] = [
  AfAttribute.OrgId,
  AfAttribute.ProjectId,
  AfAttribute.CaseId,
  AfAttribute.TaskId,
  AfAttribute.LoopId,
  AfAttribute.WorkflowRunId,
  AfAttribute.ComputeTargetId,
  AfAttribute.ConversationId,
  AfAttribute.TurnId,
];

/** Keep the allow-listed keys whose value is a safe id string. */
export function pickAfIds(attrs: Record<string, unknown>): AfIds {
  const ids: AfIds = {};
  for (const key of AF_ID_ATTRIBUTES) {
    const value = attrs[key];
    if (typeof value === "string" && AF_ID_VALUE_PATTERN.test(value)) {
      ids[key] = value;
    }
  }
  return ids;
}

/** `k=v` pairs joined by `,` in allow-list order; undefined when empty or over 512 chars. */
export function buildAfBaggage(ids: AfIds): string | undefined {
  const parts: string[] = [];
  for (const key of AF_ID_ATTRIBUTES) {
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

/** Parse a baggage string back into ids. Unknown keys, bad values and over-length input are dropped. */
export function parseAfBaggage(value: unknown): AfIds {
  if (typeof value !== "string" || value.length > MAX_BAGGAGE_LENGTH) {
    return {};
  }
  const ids: AfIds = {};
  for (const member of value.split(",")) {
    const pair = member.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = pair.slice(0, separator).trim();
    const decoded = decodeValue(pair.slice(separator + 1).trim());
    const allowed = AF_ID_ATTRIBUTES.find((candidate) => candidate === key);
    if (allowed && decoded !== undefined && AF_ID_VALUE_PATTERN.test(decoded)) {
      ids[allowed] = decoded;
    }
  }
  return ids;
}

function decodeValue(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}
