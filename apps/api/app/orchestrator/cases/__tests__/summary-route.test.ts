import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../summary/route";

const mocks = vi.hoisted(() => ({
  summaryForOrg: vi.fn(),
}));

vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (request: NextRequest, context: { params: Promise<unknown> }) =>
      handler(
        { user: { id: "user-1", organizationId: "org-1" } },
        request,
        context?.params
      ),
}));

vi.mock("@/app/orchestrator/cases/service", () => ({
  orchestratorCaseService: { summaryForOrg: mocks.summaryForOrg },
}));

const call = (query = "") =>
  GET(new NextRequest(`http://localhost/orchestrator/cases/summary${query}`), {
    params: Promise.resolve({}),
  } as never);

describe("GET /orchestrator/cases/summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes the caller's org with the parsed filters", async () => {
    const summary = { total: 3 };
    mocks.summaryForOrg.mockResolvedValue(summary);

    const response = await call("?status=open");

    expect(response.status).toBe(200);
    expect(mocks.summaryForOrg).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ status: "open" })
    );
    expect(JSON.stringify(await response.json())).toContain('"total":3');
  });

  it("returns 500 when the service fails", async () => {
    mocks.summaryForOrg.mockRejectedValue(new Error("boom"));

    const response = await call();

    expect(response.status).toBe(500);
  });
});
