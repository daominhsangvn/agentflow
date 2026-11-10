import { Result, Status } from "@repo/api/src/types/result";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/orchestrator/cases/[id]/route";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import { denyUnlessOrgAdmin } from "@/lib/auth/deny-unless-org-admin";
import type { AuthContext } from "@/lib/auth/with-auth";
import {
  createMockRequest,
  createMockRouteContext,
  createTestAuthContext,
} from "../utils/auth-helpers";

let mockAuthContext: AuthContext;

vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth: (handler: any) => async (request: any, context: any) =>
    handler(mockAuthContext, request, context?.params),
}));
vi.mock("@/lib/auth/deny-unless-org-admin");
vi.mock("@/app/orchestrator/cases/service");

const CASE_ID = "11111111-1111-7111-8111-111111111111";

function call() {
  return DELETE(
    createMockRequest({
      url: `http://localhost:3002/api/orchestrator/cases/${CASE_ID}`,
      method: "DELETE",
    }),
    createMockRouteContext({ id: CASE_ID })
  );
}

describe("DELETE /orchestrator/cases/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext = createTestAuthContext({
      user: { id: "user-1", organizationId: "org-1" } as any,
    });
    vi.mocked(denyUnlessOrgAdmin).mockResolvedValue(null);
    vi.mocked(orchestratorCaseService.remove).mockResolvedValue(
      Result.ok({ caseId: CASE_ID })
    );
  });

  it("deletes the case", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ deleted: true });
    expect(orchestratorCaseService.remove).toHaveBeenCalledWith(
      "org-1",
      CASE_ID
    );
  });

  it("returns 409 while the case has active work", async () => {
    vi.mocked(orchestratorCaseService.remove).mockResolvedValue(
      Result.err(Status.Conflict)
    );
    const response = await call();
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain(
      "running turn or task"
    );
  });

  it("returns 404 for a missing case", async () => {
    vi.mocked(orchestratorCaseService.remove).mockResolvedValue(
      Result.err(Status.NotFound)
    );
    const response = await call();
    expect(response.status).toBe(404);
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(denyUnlessOrgAdmin).mockResolvedValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }) as any
    );
    const response = await call();
    expect(response.status).toBe(403);
    expect(orchestratorCaseService.remove).not.toHaveBeenCalled();
  });

  it("returns 500 when the service rejects", async () => {
    vi.mocked(orchestratorCaseService.remove).mockRejectedValue(
      new Error("db down")
    );
    const response = await call();
    expect(response.status).toBe(500);
  });
});
