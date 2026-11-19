import { Result, Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    orchestratorTurn: { findFirst: vi.fn(), updateMany: vi.fn() },
    orchestratorConversation: { updateMany: vi.fn() },
  };
  return { db, findOwnedById: vi.fn() };
});

vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { findOwnedById: mocks.findOwnedById },
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/app/orchestrator-tools/token", () => ({
  mintOrchestratorToken: () => ({ token: "ost_x", hash: "h" }),
}));
vi.mock("@repo/database", () => ({
  Prisma: { DbNull: null },
  withDb: Object.assign((fn: (db: unknown) => unknown) => fn(mocks.db), {
    tx: (fn: (db: unknown) => unknown) => fn(mocks.db),
  }),
}));

import { desktopOrchestratorSessionService } from "./service";

function exchange(freshSession: boolean) {
  return desktopOrchestratorSessionService.issue({
    organizationId: "org-1",
    userId: "user-1",
    clerkUserId: null,
    computeTargetId: "ct-1",
    turnId: "turn-1",
    freshSession,
  });
}

describe("desktopOrchestratorSessionService.issue", () => {
  beforeEach(() => {
    mocks.findOwnedById.mockReset().mockResolvedValue({ id: "ct-1" });
    mocks.db.orchestratorTurn.findFirst.mockReset().mockResolvedValue({
      startedAt: new Date(),
      usage: null,
      conversationId: "conv-1",
    });
    mocks.db.orchestratorTurn.updateMany
      .mockReset()
      .mockResolvedValue({ count: 1 });
    mocks.db.orchestratorConversation.updateMany.mockReset();
  });

  it("an exchange keeps the conversation's runners_list record", async () => {
    const result = await exchange(false);
    expect(result.ok).toBe(true);
    expect(mocks.db.orchestratorConversation.updateMany).not.toHaveBeenCalled();
  });

  it("a fresh-session exchange clears the record", async () => {
    const result = await exchange(true);
    expect(result.ok).toBe(true);
    expect(mocks.db.orchestratorConversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", organizationId: "org-1" },
      data: { runnersRead: null },
    });
  });

  it("a turn that is no longer running clears nothing", async () => {
    mocks.db.orchestratorTurn.updateMany.mockResolvedValue({ count: 0 });
    expect(await exchange(true)).toEqual(Result.err(Status.NotFound));
    expect(mocks.db.orchestratorConversation.updateMany).not.toHaveBeenCalled();
  });

  it("another computer's turn is refused", async () => {
    mocks.findOwnedById.mockResolvedValue(null);
    expect(await exchange(true)).toEqual(Result.err(Status.Forbidden));
  });
});
