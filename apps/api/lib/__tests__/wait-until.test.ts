import { beforeEach, describe, expect, it, vi } from "vitest";

const { runInLinkedSpan, logError } = vi.hoisted(() => ({
  runInLinkedSpan: vi.fn(
    (_name: string, _attrs: object, fn: () => Promise<unknown>) => fn()
  ),
  logError: vi.fn(),
}));

vi.mock("@repo/observability/span", () => ({ runInLinkedSpan }));
vi.mock("@repo/observability/log", () => ({ log: { error: logError } }));

import { waitUntil } from "../wait-until";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("waitUntil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a promise in the default linked span", async () => {
    waitUntil(Promise.resolve("ok"));
    expect(runInLinkedSpan).toHaveBeenCalledWith(
      "background.wait_until",
      {},
      expect.any(Function)
    );
    const fn = runInLinkedSpan.mock.calls[0][2];
    await expect(fn()).resolves.toBe("ok");
  });

  it("invokes a thunk exactly once", async () => {
    const thunk = vi.fn(async () => "done");
    waitUntil(thunk);
    await flush();
    expect(thunk).toHaveBeenCalledTimes(1);
    expect(runInLinkedSpan.mock.calls[0][2]).toBe(thunk);
  });

  it("forwards a custom span name", () => {
    waitUntil(Promise.resolve(), "custom.name");
    expect(runInLinkedSpan.mock.calls[0][0]).toBe("custom.name");
  });

  it("logs a rejected promise without an unhandled rejection", async () => {
    waitUntil(Promise.reject(new Error("boom")));
    await flush();
    expect(logError).toHaveBeenCalledWith(
      "[waitUntil] background task failed",
      {
        error: "boom",
      }
    );
  });

  it("logs a rejected thunk", async () => {
    waitUntil(() => Promise.reject(new Error("thunk boom")));
    await flush();
    expect(logError).toHaveBeenCalledWith(
      "[waitUntil] background task failed",
      {
        error: "thunk boom",
      }
    );
  });

  it("logs a thunk that throws synchronously", async () => {
    const actual = await vi.importActual<
      typeof import("@repo/observability/span")
    >("@repo/observability/span");
    runInLinkedSpan.mockImplementationOnce(actual.runInLinkedSpan as never);
    waitUntil((): Promise<unknown> => {
      throw new Error("sync boom");
    });
    await flush();
    expect(logError).toHaveBeenCalledWith(
      "[waitUntil] background task failed",
      { error: "sync boom" }
    );
  });
});
