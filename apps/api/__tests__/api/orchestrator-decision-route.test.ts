import { Result, Status } from "@repo/api/src/types/result";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/orchestrator/decisions/[id]/route";
import { orchestratorDecisionService } from "@/app/orchestrator/decisions/service";
import { denyUnlessPermitted } from "@/lib/auth/deny-unless-permitted";
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
vi.mock("@/lib/auth/deny-unless-permitted");
vi.mock("@/app/orchestrator/decisions/service");

const DECISION_ID = "11111111-1111-7111-8111-111111111111";

function call(body: unknown) {
  return POST(
    createMockRequest({
      url: `http://localhost:3002/api/orchestrator/decisions/${DECISION_ID}`,
      method: "POST",
      body,
    }),
    createMockRouteContext({ id: DECISION_ID })
  );
}

describe("POST /orchestrator/decisions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext = createTestAuthContext({
      user: { id: "user-1", organizationId: "org-1" } as any,
    });
    vi.mocked(denyUnlessPermitted).mockResolvedValue(null);
    vi.mocked(orchestratorDecisionService.decideByButton).mockResolvedValue(
      Result.ok({ conversationId: "conv-1" })
    );
  });

  it("returns the conversation id", async () => {
    const response = await call({ approved: true });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ conversationId: "conv-1" });
    expect(orchestratorDecisionService.decideByButton).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      DECISION_ID,
      { approved: true }
    );
  });

  it("returns 404 for a decision that is not pending", async () => {
    vi.mocked(orchestratorDecisionService.decideByButton).mockResolvedValue(
      Result.err(Status.NotFound)
    );
    const response = await call({ approved: true });
    expect(response.status).toBe(404);
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(denyUnlessPermitted).mockResolvedValue(
      NextResponse.json({ error: "forbidden" }, { status: 403 }) as any
    );
    const response = await call({ approved: true });
    expect(response.status).toBe(403);
    expect(orchestratorDecisionService.decideByButton).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const response = await call({ approved: "yes" });
    expect(response.status).toBe(400);
  });
});
