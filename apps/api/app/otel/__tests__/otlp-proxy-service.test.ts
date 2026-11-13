import {
  OTLP_PROXY_CONTENT_TYPE,
  OTLP_PROXY_MAX_BODY_BYTES,
  OtlpProxySignal,
} from "@repo/api/src/types/otlp-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otlpProxyService } from "@/app/otel/otlp-proxy-service";
import { readCappedRequestBytes } from "@/lib/route-utils";

const ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT";
let principalCounter = 0;

function makeRequest(init: {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  url?: string;
}): Request {
  return new Request(init.url ?? "http://api.test/otel/v1/traces?x=1", {
    method: "POST",
    headers: {
      "content-type": OTLP_PROXY_CONTENT_TYPE,
      ...init.headers,
    },
    body: init.body === undefined ? new Uint8Array([1, 2, 3]) : init.body,
  });
}

function nextPrincipal(): string {
  principalCounter += 1;
  return `org:user-${principalCounter}`;
}

function okFetch(status = 200) {
  return vi.fn(async () => new Response(null, { status }));
}

describe("otlpProxyService", () => {
  beforeEach(() => {
    vi.stubEnv(ENDPOINT_ENV, "http://collector:4318/");
    vi.stubEnv("OTEL_SDK_DISABLED", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("resolveUpstream", () => {
    it("normalizes the configured endpoint", () => {
      expect(otlpProxyService.resolveUpstream()).toEqual({
        ok: true,
        baseUrl: "http://collector:4318",
      });
    });

    it("is not ok when the endpoint is unset", () => {
      vi.stubEnv(ENDPOINT_ENV, "");
      expect(otlpProxyService.resolveUpstream()).toEqual({ ok: false });
    });

    it("rejects non-http schemes and credentials", () => {
      vi.stubEnv(ENDPOINT_ENV, "file:///etc/passwd");
      expect(otlpProxyService.resolveUpstream()).toEqual({ ok: false });
      vi.stubEnv(ENDPOINT_ENV, "http://user:pw@collector:4318");
      expect(otlpProxyService.resolveUpstream()).toEqual({ ok: false });
    });
  });

  describe("precheck", () => {
    it("passes a valid request", () => {
      expect(
        otlpProxyService.precheck(makeRequest({}), OtlpProxySignal.Traces)
      ).toBeNull();
    });

    it("returns 404 when no upstream is configured", () => {
      vi.stubEnv(ENDPOINT_ENV, "");
      expect(
        otlpProxyService.precheck(makeRequest({}), OtlpProxySignal.Traces)
      ).toEqual({ status: 404 });
    });

    it("returns 404 for an unknown or traversal signal", () => {
      expect(otlpProxyService.precheck(makeRequest({}), "../admin")).toEqual({
        status: 404,
      });
    });

    it("returns 415 for a non-protobuf content type", () => {
      const request = makeRequest({
        headers: { "content-type": "application/json" },
      });
      expect(otlpProxyService.precheck(request, OtlpProxySignal.Logs)).toEqual({
        status: 415,
      });
    });

    it("accepts content type parameters and casing", () => {
      const request = makeRequest({
        headers: { "content-type": "Application/X-Protobuf; charset=binary" },
      });
      expect(
        otlpProxyService.precheck(request, OtlpProxySignal.Logs)
      ).toBeNull();
    });

    it("returns 413 when content-length exceeds the cap", () => {
      const request = makeRequest({
        headers: { "content-length": String(600 * 1024) },
      });
      expect(
        otlpProxyService.precheck(request, OtlpProxySignal.Traces)
      ).toEqual({ status: 413 });
    });
  });

  describe("forward", () => {
    it("answers 408 when the body trickles past the deadline", async () => {
      vi.useFakeTimers();
      try {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
        });
        const fetchImpl = okFetch();
        const pending = otlpProxyService.forward({
          principalKey: nextPrincipal(),
          signal: OtlpProxySignal.Traces,
          request: new Request("http://api.test/otel/v1/traces", {
            method: "POST",
            headers: { "content-type": OTLP_PROXY_CONTENT_TYPE },
            body,
            duplex: "half",
          } as RequestInit),
          fetchImpl,
        });
        await vi.advanceTimersByTimeAsync(6000);
        expect(await pending).toEqual({ status: 408 });
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("posts to the fixed upstream with only the fixed header", async () => {
      const fetchImpl = okFetch();
      const request = makeRequest({
        url: "http://evil.example/other/path?target=http://169.254.169.254",
        headers: {
          authorization: "Bearer sk_live_secret",
          "x-forwarded-host": "evil.example",
          host: "evil.example",
        },
      });

      const result = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request,
        fetchImpl,
      });

      expect(result).toEqual({ status: 200 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("http://collector:4318/v1/traces");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": OTLP_PROXY_CONTENT_TYPE });
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("returns 404 without fetching when the upstream is not configured", async () => {
      vi.stubEnv(ENDPOINT_ENV, "");
      const fetchImpl = okFetch();
      const result = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request: makeRequest({}),
        fetchImpl,
      });
      expect(result).toEqual({ status: 404 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("returns 413 for an oversized streamed body without content-length", async () => {
      const fetchImpl = okFetch();
      const big = new Uint8Array(OTLP_PROXY_MAX_BODY_BYTES + 1);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(big);
          controller.close();
        },
      });
      const request = new Request("http://api.test/otel/v1/traces", {
        method: "POST",
        headers: { "content-type": OTLP_PROXY_CONTENT_TYPE },
        body: stream,
        duplex: "half",
      } as RequestInit);

      const result = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request,
        fetchImpl,
      });
      expect(result).toEqual({ status: 413 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("returns 400 for an empty body", async () => {
      const fetchImpl = okFetch();
      const result = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Metrics,
        request: makeRequest({ body: new Uint8Array(0) }),
        fetchImpl,
      });
      expect(result).toEqual({ status: 400 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rate limits a principal after 240 requests per window", async () => {
      const principalKey = nextPrincipal();
      const fetchImpl = okFetch();
      for (let i = 0; i < 240; i += 1) {
        const ok = await otlpProxyService.forward({
          principalKey,
          signal: OtlpProxySignal.Traces,
          request: makeRequest({}),
          fetchImpl,
        });
        expect(ok.status).toBe(200);
      }
      const limited = await otlpProxyService.forward({
        principalKey,
        signal: OtlpProxySignal.Traces,
        request: makeRequest({}),
        fetchImpl,
      });
      expect(limited).toEqual({ status: 429, retryAfterSeconds: 60 });
      expect(fetchImpl).toHaveBeenCalledTimes(240);

      const other = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request: makeRequest({}),
        fetchImpl,
      });
      expect(other.status).toBe(200);
    });

    it("caps concurrent in-flight forwards at 32", async () => {
      const release: Array<() => void> = [];
      const hangingFetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release.push(() => resolve(new Response(null, { status: 200 })));
          })
      );
      const pending = Array.from({ length: 32 }, () =>
        otlpProxyService.forward({
          principalKey: nextPrincipal(),
          signal: OtlpProxySignal.Traces,
          request: makeRequest({}),
          fetchImpl: hangingFetch,
        })
      );
      await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledTimes(32));

      const rejected = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request: makeRequest({}),
        fetchImpl: hangingFetch,
      });
      expect(rejected.status).toBe(429);
      expect(rejected.retryAfterSeconds).toBe(30);
      expect(hangingFetch).toHaveBeenCalledTimes(32);

      for (const fn of release) {
        fn();
      }
      await Promise.all(pending);

      const after = await otlpProxyService.forward({
        principalKey: nextPrincipal(),
        signal: OtlpProxySignal.Traces,
        request: makeRequest({}),
        fetchImpl: okFetch(),
      });
      expect(after.status).toBe(200);
    });

    it("maps upstream statuses", async () => {
      const run = (fetchImpl: typeof fetch) =>
        otlpProxyService.forward({
          principalKey: nextPrincipal(),
          signal: OtlpProxySignal.Traces,
          request: makeRequest({}),
          fetchImpl,
        });

      expect(await run(okFetch(204))).toEqual({ status: 200 });
      expect(await run(okFetch(400))).toEqual({ status: 400 });
      expect(await run(okFetch(302))).toEqual({ status: 400 });
      expect(await run(okFetch(500))).toEqual({
        status: 503,
        retryAfterSeconds: 30,
      });
      expect(
        await run(
          vi.fn(() => {
            return Promise.reject(new DOMException("aborted", "AbortError"));
          }) as unknown as typeof fetch
        )
      ).toEqual({ status: 503, retryAfterSeconds: 30 });
    });
  });
});

describe("readCappedRequestBytes", () => {
  it("concatenates chunks under the cap", async () => {
    const request = new Request("http://x.test", {
      method: "POST",
      body: new Uint8Array([1, 2, 3, 4]),
    });
    const result = await readCappedRequestBytes(request, 10);
    expect(result).toEqual({ ok: true, value: new Uint8Array([1, 2, 3, 4]) });
  });

  it("fails over the cap", async () => {
    const request = new Request("http://x.test", {
      method: "POST",
      body: new Uint8Array(11),
    });
    expect(await readCappedRequestBytes(request, 10)).toEqual({ ok: false });
  });

  it("returns empty bytes without a body", async () => {
    const result = await readCappedRequestBytes(
      new Request("http://x.test"),
      10
    );
    expect(result).toEqual({ ok: true, value: new Uint8Array(0) });
  });
});
