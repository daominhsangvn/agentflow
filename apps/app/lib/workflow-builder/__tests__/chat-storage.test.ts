import { WORKFLOW_BUILDER_MAX_MESSAGES } from "@repo/api/src/types/workflow-builder";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadStoredMessages,
  saveStoredMessages,
  workflowBuilderStorageKey,
} from "../chat-storage";

const ORG = "org_1";
const WORKFLOW_ID = "55555555-5555-4555-8555-555555555555";

function message(index: number): UIMessage {
  return {
    id: `m${index}`,
    role: "user",
    parts: [{ type: "text", text: `hello ${index}` }],
  };
}

describe("workflow builder chat storage", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keys by organization and workflow or draft", () => {
    expect(workflowBuilderStorageKey(ORG, null)).toBe(
      "af:workflow-builder:v1:org_1:new"
    );
    expect(workflowBuilderStorageKey(ORG, WORKFLOW_ID)).toBe(
      `af:workflow-builder:v1:org_1:${WORKFLOW_ID}`
    );
  });

  it("round-trips messages", async () => {
    const key = workflowBuilderStorageKey(ORG, null);
    saveStoredMessages(key, [message(1), message(2)]);

    expect(await loadStoredMessages(key)).toEqual([message(1), message(2)]);
  });

  it("reads corrupt or invalid history as empty", async () => {
    const key = workflowBuilderStorageKey(ORG, null);
    globalThis.localStorage.setItem(key, "{not json");
    expect(await loadStoredMessages(key)).toEqual([]);

    globalThis.localStorage.setItem(key, JSON.stringify([{ nope: true }]));
    expect(await loadStoredMessages(key)).toEqual([]);
  });

  it("keeps only the last messages", async () => {
    const key = workflowBuilderStorageKey(ORG, null);
    const many = Array.from(
      { length: WORKFLOW_BUILDER_MAX_MESSAGES + 5 },
      (_, index) => message(index)
    );
    saveStoredMessages(key, many);

    const stored = await loadStoredMessages(key);
    expect(stored).toHaveLength(WORKFLOW_BUILDER_MAX_MESSAGES);
    expect(stored.at(-1)?.id).toBe(many.at(-1)?.id);
  });

  it("swallows a storage quota error", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() =>
      saveStoredMessages(workflowBuilderStorageKey(ORG, null), [message(1)])
    ).not.toThrow();
  });
});
