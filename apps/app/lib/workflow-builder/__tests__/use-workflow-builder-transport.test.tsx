import {
  DEPLOYMENT_ID_HEADER,
  ORG_IDENTITY_HEADER,
} from "@repo/api/src/types/headers";
import { WORKFLOW_BUILDER_CHAT_PATH } from "@repo/api/src/types/workflow-builder";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkflowBuilderTransport } from "../use-workflow-builder-transport";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@repo/app/shared/api/provider", () => ({
  useApiAdapter: () => ({
    resolveApiOrigin: () => "https://api.test",
    fetch: mocks.fetch,
    deploymentId: "dpl_1",
  }),
}));
vi.mock("@repo/app/shared/auth/use-auth-snapshot", () => ({
  useAuthSnapshot: () => ({
    isLoaded: true,
    userId: "u1",
    orgId: "org_1",
    getToken: () => Promise.resolve("tok_1"),
  }),
}));
vi.mock("@repo/app/shared/auth/use-wait-for-auth-loaded", () => ({
  useWaitForAuthLoaded: () => () => Promise.resolve(),
}));

describe("useWorkflowBuilderTransport", () => {
  it("sends the latest editor YAML with bearer, org and deployment headers", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    );
    let yaml = "name: one";
    const getEditorYaml = () => yaml;
    const { result } = renderHook(() =>
      useWorkflowBuilderTransport({ workflowId: null, getEditorYaml })
    );
    yaml = "name: two";

    await result.current.sendMessages({
      chatId: "c1",
      messageId: undefined,
      trigger: "submit-message",
      abortSignal: undefined,
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    });

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe(`https://api.test${WORKFLOW_BUILDER_CHAT_PATH}`);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok_1");
    expect(headers.get(ORG_IDENTITY_HEADER)).toBe("org_1");
    expect(headers.get(DEPLOYMENT_ID_HEADER)).toBe("dpl_1");
    const body = JSON.parse(init.body);
    expect(body.editorYaml).toBe("name: two");
    expect(body.workflowId).toBeUndefined();
    expect(body.messages).toHaveLength(1);
  });
});
