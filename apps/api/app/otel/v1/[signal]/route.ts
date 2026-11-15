import { ApiKeyScope } from "@repo/api/src/types/api-key";
import {
  OTLP_PROXY_CONTENT_TYPE,
  type OtlpProxySignal,
} from "@repo/api/src/types/otlp-proxy";
import { type NextRequest, NextResponse } from "next/server";
import { otlpProxyService } from "@/app/otel/otlp-proxy-service";
import { withApiKeyAuth } from "@/lib/auth/with-api-key-auth";

type OtlpProxyRouteContext = { params: Promise<{ signal: string }> };

const authenticatedForward = withApiKeyAuth(
  async ({ user }, request, params) => {
    const { signal } = await params;
    const result = await otlpProxyService.forward({
      principalKey: `${user.organizationId}:${user.id}`,
      // precheck already rejected every value that is not an OtlpProxySignal.
      signal: signal as OtlpProxySignal,
      request,
    });
    // Bodyless OTLP response, not an ApiResult JSON envelope: cast once to the
    // wrapper's response type.
    return toResponse(result) as never;
  },
  { requiredScopes: [ApiKeyScope.Write] }
);

export const POST = async (
  request: NextRequest,
  context: OtlpProxyRouteContext
) => {
  const { signal } = await context.params;
  const rejected = otlpProxyService.precheck(request, signal);
  if (rejected) {
    return toResponse(rejected);
  }
  return authenticatedForward(request, context);
};

function toResponse(result: {
  status: number;
  retryAfterSeconds?: number;
}): NextResponse {
  const headers: Record<string, string> = {};
  if (result.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }
  if (result.status === 200) {
    headers["Content-Type"] = OTLP_PROXY_CONTENT_TYPE;
  }
  return new NextResponse(null, { status: result.status, headers });
}
