import { afterEach, describe, expect, it, vi } from "vitest";
import { createTraceparent, traceparentFetch } from "./traceparent-fetch";

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const TRACE_PREFIX_RE = /^00-[0-9a-f]{32}-/;

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createTraceparent", () => {
  it("matches the W3C format", () => {
    expect(createTraceparent()).toMatch(TRACEPARENT_RE);
  });

  it("differs between calls", () => {
    expect(createTraceparent()).not.toBe(createTraceparent());
  });

  it("regenerates all-zero ids", () => {
    let calls = 0;
    const random = (n: number) => {
      calls += 1;
      return calls === 1 ? new Uint8Array(n) : new Uint8Array(n).fill(1);
    };

    expect(createTraceparent(random)).toBe(
      `00-${"01".repeat(16)}-${"01".repeat(8)}-01`
    );
  });
});

describe("traceparentFetch", () => {
  it("adds a traceparent header and passes signal and headers through", async () => {
    const fetchMock = stubFetch();
    const controller = new AbortController();

    await traceparentFetch("https://api.test/x", {
      headers: { "x-a": "1" },
      signal: controller.signal,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("traceparent")).toMatch(TRACE_PREFIX_RE);
    expect(headers.get("x-a")).toBe("1");
    expect(init.signal).toBe(controller.signal);
  });

  it("preserves an existing traceparent", async () => {
    const fetchMock = stubFetch();

    await traceparentFetch("https://api.test/x", {
      headers: { traceparent: "00-abc-def-01" },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("traceparent")).toBe("00-abc-def-01");
  });
});
