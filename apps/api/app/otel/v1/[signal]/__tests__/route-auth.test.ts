/**
 * Pins the real withApiKeyAuth composition of the OTLP proxy route: only the
 * services behind it are mocked, so a missing/invalid/read-only key must never
 * reach `otlpProxyService.forward`.
 */
import { ApiKeyScope } from "@repo/api/src/types/api-key";
import {
  OTLP_PROXY_CONTENT_TYPE,
  OtlpProxySignal,
} from "@repo/api/src/types/otlp-proxy";
import { ApiKeySource } from "@repo/database";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forward: vi.fn(),
  precheck: vi.fn(),
}));

vi.mock("@repo/observability/log", () => ({
  log: { error: vi.fn(), flush: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));
vi.mock("@/app/api-keys/service", () => ({
  apiKeysService: {
    touchLastUsedAt: vi.fn(),
    verifyKeyWithMetadata: vi.fn(),
  },
}));
vi.mock("@/app/organizations/service", () => ({
  organizationsService: { findById: vi.fn() },
}));
vi.mock("@/app/users/service", () => ({
  usersService: { findById: vi.fn() },
}));
vi.mock("@/app/otel/otlp-proxy-service", () => ({
  otlpProxyService: { precheck: mocks.precheck, forward: mocks.forward },
}));

import { apiKeysService } from "@/app/api-keys/service";
import { organizationsService } from "@/app/organizations/service";
import { usersService } from "@/app/users/service";
import { POST } from "../route";

const verifyKey = apiKeysService.verifyKeyWithMetadata as Mock;
const findUser = usersService.findById as Mock;
const findOrg = organizationsService.findById as Mock;

function call(authorization?: string) {
  const headers: Record<string, string> = {
    "content-type": OTLP_PROXY_CONTENT_TYPE,
  };
  if (authorization) {
    headers.authorization = authorization;
  }
  const request = new NextRequest("http://api.test/otel/v1/traces", {
    method: "POST",
    headers,
    body: new Uint8Array([1]),
  });
  return POST(request, {
    params: Promise.resolve({ signal: OtlpProxySignal.Traces }),
  });
}

function keyWithScopes(scopes: ApiKeyScope[]) {
  return {
    apiKeyId: "key-1",
    userId: "user-1",
    organizationId: "org-1",
    scopes,
    source: ApiKeySource.USER_CREATED,
    gatewayId: null,
    boundPublicKey: null,
  };
}

describe("POST /otel/v1/[signal] with the real withApiKeyAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.precheck.mockReturnValue(null);
    mocks.forward.mockResolvedValue({ status: 200 });
    findUser.mockResolvedValue({
      id: "user-1",
      clerkId: "clerk_user_1",
      organizationId: "org-1",
      active: true,
    });
    findOrg.mockResolvedValue({ id: "org-1", clerkId: "org_clerk_1" });
  });

  it("returns 401 without a bearer token", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown key", async () => {
    verifyKey.mockResolvedValue(null);
    const response = await call("Bearer sk_live_unknown");
    expect(response.status).toBe(401);
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("returns 403 for a read-only key", async () => {
    verifyKey.mockResolvedValue(keyWithScopes([ApiKeyScope.Read]));
    const response = await call("Bearer sk_live_readonly");
    expect(response.status).toBe(403);
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("forwards for a write key", async () => {
    verifyKey.mockResolvedValue(keyWithScopes([ApiKeyScope.Write]));
    const response = await call("Bearer sk_live_writer");
    expect(response.status).toBe(200);
    expect(mocks.forward).toHaveBeenCalledTimes(1);
  });
});
