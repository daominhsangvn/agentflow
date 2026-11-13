import { ApiKeyScope } from "@repo/api/src/types/api-key";
import {
  OTLP_PROXY_CONTENT_TYPE,
  OtlpProxySignal,
} from "@repo/api/src/types/otlp-proxy";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authCalls: vi.fn(),
  authOptions: vi.fn(),
  precheck: vi.fn(),
  forward: vi.fn(),
}));

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  withApiKeyAuth: (
    handler: (
      ctx: unknown,
      request: Request,
      params: Promise<Record<string, string>>
    ) => Promise<Response>,
    options: unknown
  ) => {
    mocks.authOptions(options);
    return (request: Request, routeContext: { params: Promise<never> }) => {
      mocks.authCalls();
      return handler(
        { user: { id: "user-1", organizationId: "org-1" } },
        request,
        routeContext.params
      );
    };
  },
}));

vi.mock("@/app/otel/otlp-proxy-service", () => ({
  otlpProxyService: { precheck: mocks.precheck, forward: mocks.forward },
}));

import { POST } from "../route";

function call(signal: string) {
  const request = new NextRequest(`http://api.test/otel/v1/${signal}`, {
    method: "POST",
    headers: { "content-type": OTLP_PROXY_CONTENT_TYPE },
    body: new Uint8Array([1]),
  });
  return POST(request, { params: Promise.resolve({ signal }) });
}

describe("POST /otel/v1/[signal]", () => {
  beforeEach(() => {
    mocks.authCalls.mockClear();
    mocks.precheck.mockReset();
    mocks.forward.mockReset();
    mocks.precheck.mockReturnValue(null);
  });

  it("requires the write scope", () => {
    expect(mocks.authOptions).toHaveBeenCalledWith({
      requiredScopes: [ApiKeyScope.Write],
    });
  });

  it("rejects on precheck before authenticating", async () => {
    mocks.precheck.mockReturnValue({ status: 415 });
    const response = await call(OtlpProxySignal.Traces);
    expect(response.status).toBe(415);
    expect(mocks.authCalls).not.toHaveBeenCalled();
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("returns an empty protobuf body on success", async () => {
    mocks.forward.mockResolvedValue({ status: 200 });
    const response = await call(OtlpProxySignal.Traces);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(OTLP_PROXY_CONTENT_TYPE);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(mocks.forward).toHaveBeenCalledWith(
      expect.objectContaining({
        principalKey: "org-1:user-1",
        signal: OtlpProxySignal.Traces,
      })
    );
  });

  it("carries Retry-After on 429", async () => {
    mocks.forward.mockResolvedValue({ status: 429, retryAfterSeconds: 60 });
    const response = await call(OtlpProxySignal.Logs);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
