import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/orchestrator/cases/[id]/tasks/[taskId]/file/route";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
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
vi.mock("@/app/orchestrator/cases/service");

const CASE_ID = "11111111-1111-7111-8111-111111111111";
const TASK_ID = "22222222-2222-7222-8222-222222222222";

function call(query = "?name=notes.md", caseId = CASE_ID) {
  return GET(
    createMockRequest({
      url: `http://localhost:3002/api/orchestrator/cases/${caseId}/tasks/${TASK_ID}/file${query}`,
    }),
    createMockRouteContext({ id: caseId, taskId: TASK_ID })
  );
}

describe("GET /orchestrator/cases/[id]/tasks/[taskId]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext = createTestAuthContext({
      user: { id: "user-1", organizationId: "org-1" } as any,
    });
    vi.mocked(orchestratorCaseService.readTaskFile).mockResolvedValue({
      bytes: new TextEncoder().encode("# Hi"),
      fileName: "notes.md",
      contentType: "text/markdown; charset=utf-8",
    });
  });

  it("returns the bytes as an attachment", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(response.headers.get("Content-Disposition")).toContain(
      'attachment; filename="notes.md"'
    );
    expect(await response.text()).toBe("# Hi");
    expect(orchestratorCaseService.readTaskFile).toHaveBeenCalledWith(
      "org-1",
      CASE_ID,
      TASK_ID,
      "notes.md"
    );
  });

  it("returns 404 when the service finds nothing", async () => {
    vi.mocked(orchestratorCaseService.readTaskFile).mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("returns 400 without a name", async () => {
    expect((await call("")).status).toBe(400);
  });

  it("returns 400 for a bad case id", async () => {
    expect((await call("?name=a.md", "not-a-uuid")).status).toBe(400);
  });
});
