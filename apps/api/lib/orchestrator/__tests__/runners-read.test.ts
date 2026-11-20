import type { ComputeTargetCapabilities } from "@repo/api/src/types/runner-capabilities";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  Prisma: { DbNull: null },
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorConversation: {
        updateMany: mocks.updateMany,
        findFirst: mocks.findFirst,
      },
    }),
}));

import {
  clearRunnersRead,
  loadRunnersRead,
  recordRunnersRead,
  runnersReadWrittenBy,
} from "../runners-read";

function file(
  computeTargetId: string,
  contentHash: string
): ComputeTargetCapabilities {
  return { computeTargetId, contentHash } as ComputeTargetCapabilities;
}

describe("runners-read", () => {
  beforeEach(() => {
    mocks.updateMany.mockReset().mockResolvedValue({ count: 1 });
    mocks.findFirst.mockReset();
  });

  it("records each runner's contentHash by compute target", async () => {
    const hashes = await recordRunnersRead({
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      turnId: "turn-1",
      files: [file("ct-1", "h1"), file("ct-2", "h2")],
    });
    expect(hashes).toEqual({ "ct-1": "h1", "ct-2": "h2" });
    const arg = mocks.updateMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ id: "conv-1", organizationId: "org-1" });
    expect(arg.data.runnersRead).toEqual({
      turnId: "turn-1",
      hashes: { "ct-1": "h1", "ct-2": "h2" },
    });
  });

  it("clearRunnersRead sets the record to SQL NULL in the org", async () => {
    await clearRunnersRead("org-1", "conv-1");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "conv-1", organizationId: "org-1" },
      data: { runnersRead: null },
    });
  });

  it("loads null before any runners_list", async () => {
    mocks.findFirst.mockResolvedValue({ runnersRead: null });
    expect(await loadRunnersRead("org-1", "conv-1")).toBeNull();
  });

  it("loads the stored hashes", async () => {
    mocks.findFirst.mockResolvedValue({
      runnersRead: { turnId: "t", hashes: { "ct-1": "h1" } },
    });
    expect(await loadRunnersRead("org-1", "conv-1")).toEqual({ "ct-1": "h1" });
    expect(mocks.findFirst.mock.calls[0]?.[0].where).toEqual({
      id: "conv-1",
      organizationId: "org-1",
    });
  });

  it("loads null for a malformed value", async () => {
    mocks.findFirst.mockResolvedValue({ runnersRead: { "ct-1": "h1" } });
    expect(await loadRunnersRead("org-1", "conv-1")).toBeNull();
    mocks.findFirst.mockResolvedValue({
      runnersRead: { turnId: "t", hashes: { a: 1 } },
    });
    expect(await loadRunnersRead("org-1", "conv-1")).toBeNull();
  });

  it("runnersReadWrittenBy is true only for the writing turn", () => {
    const stored = { turnId: "turn-1", hashes: {} };
    expect(runnersReadWrittenBy(stored, "turn-1")).toBe(true);
    expect(runnersReadWrittenBy(stored, "turn-2")).toBe(false);
    expect(runnersReadWrittenBy(null, "turn-1")).toBe(false);
  });
});
