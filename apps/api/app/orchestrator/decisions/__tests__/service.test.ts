import { OrchestratorDecisionVia } from "@repo/api/src/types/orchestrator";
import { Result } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorDecisionService } from "@/app/orchestrator/decisions/service";
import { decide } from "@/lib/orchestrator/decisions";

const { findUser } = vi.hoisted(() => ({ findUser: vi.fn() }));

vi.mock("@repo/database", () => ({
  withDb: (fn: any) => fn({ user: { findFirst: findUser } }),
}));
vi.mock("@/lib/orchestrator/decisions", () => ({ decide: vi.fn() }));
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceConversation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));
vi.mock("@/app/orchestrator-tools/service/decision-drafts", () => ({
  carryOutDecisionDraft: vi.fn(),
}));

describe("orchestratorDecisionService.decideByButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUser.mockResolvedValue({
      firstName: "Ada",
      lastName: "Admin",
      email: "a@x.io",
    });
    vi.mocked(decide).mockResolvedValue(
      Result.ok({
        conversationId: "conv-1",
        draftResult: null,
        draftNote: null,
      })
    );
  });

  it("passes a carryOut for the stored draft", async () => {
    const result = await orchestratorDecisionService.decideByButton(
      "org-1",
      "user-1",
      "dec-1",
      { approved: true }
    );
    expect(result).toEqual(Result.ok({ conversationId: "conv-1" }));
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        via: OrchestratorDecisionVia.Button,
        carryOut: expect.any(Function),
      })
    );
  });
});
