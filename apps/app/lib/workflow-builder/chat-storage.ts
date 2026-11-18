import { WORKFLOW_BUILDER_MAX_MESSAGES } from "@repo/api/src/types/workflow-builder";
import { safeValidateUIMessages, type UIMessage } from "ai";

/** Draft key: a workflow that is not saved yet has no id. */
export const WORKFLOW_BUILDER_DRAFT_KEY = "new";

/** One chat per organization and workflow (or draft), so tenants never share history. */
export function workflowBuilderStorageKey(
  orgId: string,
  workflowId: string | null
): string {
  return `af:workflow-builder:v1:${orgId}:${workflowId ?? WORKFLOW_BUILDER_DRAFT_KEY}`;
}

/** The stored chat, or `[]` when there is none or it is not a valid UI message list. */
export async function loadStoredMessages(key: string): Promise<UIMessage[]> {
  const raw = readItem(key);
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // observability: a corrupt history is dropped, the chat starts empty
    return [];
  }
  const validated = await safeValidateUIMessages<UIMessage>({
    messages: parsed,
  });
  return validated.success ? validated.data : [];
}

export function saveStoredMessages(key: string, messages: UIMessage[]): void {
  try {
    globalThis.localStorage?.setItem(
      key,
      JSON.stringify(messages.slice(-WORKFLOW_BUILDER_MAX_MESSAGES))
    );
  } catch {
    // observability: chat history is best-effort; a full or blocked localStorage only drops history
  }
}

export function clearStoredMessages(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // observability: chat history is best-effort; a blocked localStorage only keeps the old history
  }
}

function readItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // observability: chat history is best-effort; a blocked localStorage reads as empty
    return null;
  }
}
