import { OrgPermission } from "@repo/api/src/types/org-permissions";
/**
 * Route-level tests for GET /agent-components/compliance (FEA-4029).
 *
 * The compliance view is an admin-only Settings tab, so the DATA is gated to
 * org admins/owners at the route — not only in the UI. These tests assert the
 * server-side gate: a non-admin (member, or an API key whose owner is not an
 * admin) gets 403 and the service is never called; an admin gets the payload.
 *
 * Prisma/service are mocked; the admin check (`hasOrgPermission`) is mocked so the
 * gate branch is exercised directly.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasOrgPermission: vi.fn(),
  getCompliance: vi.fn(),
  authCtx: {
    userId: "user-1",
    organizationId: "org-1",
    clerkUserId: "clerk-user-1",
    clerkOrgId: "clerk-org-1",
  },
}));

vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (
      request: NextRequest,
      context: { params: Promise<Record<string, string>> }
    ) =>
      handler(
        {
          user: {
            id: mocks.authCtx.userId,
            organizationId: mocks.authCtx.organizationId,
          },
          clerkUserId: mocks.authCtx.clerkUserId,
          clerkOrgId: mocks.authCtx.clerkOrgId,
          authMethod: "session",
        },
        request,
        context.params
      ),
}));

vi.mock("@/lib/auth/org-permissions", () => ({
  hasOrgPermission: mocks.hasOrgPermission,
}));

vi.mock("../compliance/service", () => ({
  complianceService: {
    getCompliance: mocks.getCompliance,
  },
}));

import { GET as complianceRoute } from "../compliance/route";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/agent-components/compliance");
}

const emptyContext = { params: Promise.resolve({}) };

describe("GET /agent-components/compliance admin gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompliance.mockResolvedValue({
      items: [],
      total: 0,
      truncated: false,
    });
  });

  it("returns 403 and never queries when the caller is not an org admin", async () => {
    mocks.hasOrgPermission.mockResolvedValue(false);

    const response = await complianceRoute(makeRequest(), emptyContext);

    expect(response.status).toBe(403);
    expect(mocks.getCompliance).not.toHaveBeenCalled();
  });

  it("checks the caller's own clerk org/user for admin status", async () => {
    mocks.hasOrgPermission.mockResolvedValue(false);

    await complianceRoute(makeRequest(), emptyContext);

    expect(mocks.hasOrgPermission).toHaveBeenCalledWith(
      mocks.authCtx.clerkOrgId,
      mocks.authCtx.clerkUserId,
      OrgPermission.CatalogManage
    );
  });

  it("returns the compliance payload for an org admin", async () => {
    mocks.hasOrgPermission.mockResolvedValue(true);
    mocks.getCompliance.mockResolvedValue({
      items: [
        {
          distributionId: "dist-1",
          catalogItemName: "RTK",
          kind: "plugin",
          mode: "auto_install",
          notInstalledCount: 1,
          installedButUnusedCount: 0,
          totalTargetCount: 2,
        },
      ],
      total: 1,
      truncated: false,
    });

    const response = await complianceRoute(makeRequest(), emptyContext);

    expect(response.status).toBe(200);
    expect(mocks.getCompliance).toHaveBeenCalledWith({
      organizationId: mocks.authCtx.organizationId,
      limit: 50,
    });
    const body = await response.json();
    expect(body.data.total).toBe(1);
  });
});
