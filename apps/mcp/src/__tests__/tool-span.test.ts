import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AfAttribute } from "@repo/observability/af-attributes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { instrumentToolRegistration, withToolSpan } from "../tool-span.js";

const mocks = vi.hoisted(() => ({
  fakeSpan: { fake: true },
  withSpan: vi.fn(),
  markSpanError: vi.fn(),
}));

vi.mock("@repo/observability/span", async () => {
  const actual = await vi.importActual<
    typeof import("@repo/observability/span")
  >("@repo/observability/span");
  return {
    ...actual,
    withSpan: mocks.withSpan,
    markSpanError: mocks.markSpanError,
  };
});

function setup(result: unknown) {
  const stored: Array<(...args: unknown[]) => Promise<unknown>> = [];
  const server = {
    registerTool: (_n: string, _c: unknown, cb: never) => {
      stored.push(cb);
    },
  };
  instrumentToolRegistration(server as unknown as McpServer, {
    [AfAttribute.OrgId]: "org-1",
    [AfAttribute.UserId]: "user-1",
  });
  const cb = vi.fn(async () => result);
  (server.registerTool as (n: string, c: unknown, cb: unknown) => void)(
    "get-me",
    {},
    cb
  );
  return { stored, cb };
}

describe("instrumentToolRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withSpan.mockImplementation(
      (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) =>
        Promise.resolve(fn(mocks.fakeSpan))
    );
  });

  it("runs the callback in a named span without arguments", async () => {
    const { stored, cb } = setup({ content: [] });
    await stored[0]({ secret: "token" }, { extra: 1 });
    expect(mocks.withSpan).toHaveBeenCalledWith(
      "mcp.tool get-me",
      {
        "mcp.tool.name": "get-me",
        [AfAttribute.OrgId]: "org-1",
        [AfAttribute.UserId]: "user-1",
      },
      expect.any(Function)
    );
    expect(JSON.stringify(mocks.withSpan.mock.calls[0][1])).not.toContain(
      "token"
    );
    expect(cb).toHaveBeenCalledWith({ secret: "token" }, { extra: 1 });
    expect(mocks.markSpanError).not.toHaveBeenCalled();
  });

  it("adds af.loop_id and af.case_id for UUID arguments only", async () => {
    const id = "0190b2c4-1111-7222-8333-444455556666";
    const { stored } = setup({ content: [] });
    await stored[0]({ loopId: id, caseId: "not-a-uuid" });
    const attrs = mocks.withSpan.mock.calls[0][1];
    expect(attrs[AfAttribute.LoopId]).toBe(id);
    expect(attrs[AfAttribute.CaseId]).toBeUndefined();
  });

  it("marks the span when the result is an error", async () => {
    const { stored } = setup({ isError: true, content: [] });
    await stored[0]({});
    expect(mocks.markSpanError).toHaveBeenCalledWith(mocks.fakeSpan);
  });

  it("falls back to a fixed span name for unsafe tool names", async () => {
    const unsafe = [`bad name ${"x".repeat(100)}`, "a\nb", ""];
    for (const name of unsafe) {
      mocks.withSpan.mockClear();
      await withToolSpan(name, {}, async () => ({ content: [] }));
      expect(mocks.withSpan.mock.calls[0][0]).toBe("mcp.tool unknown");
      expect(mocks.withSpan.mock.calls[0][1]).toEqual({
        "mcp.tool.name": "unknown",
      });
    }
  });
});
