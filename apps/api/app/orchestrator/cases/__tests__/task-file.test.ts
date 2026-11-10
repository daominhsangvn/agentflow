import { Result } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCaseTaskFile } from "@/app/orchestrator/cases/service/task-file";
import { getLoopAttachment } from "@/lib/loops/loop-state";
import { findCaseTaskFiles } from "@/lib/orchestrator/task-files";

const findFirst = vi.fn();

vi.mock("@repo/database", () => ({
  withDb: (fn: any) => fn({ orchestratorTask: { findFirst } }),
}));
vi.mock("@/lib/orchestrator/task-files");
vi.mock("@/lib/loops/loop-state");

function stored(name: string) {
  return Result.ok([
    { name, size: 3, skipped: null, taskId: "t1", storageKey: "k" },
  ]);
}

describe("readCaseTaskFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({ id: "t1" });
    vi.mocked(getLoopAttachment).mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("returns null without touching storage when the task is not in the org", async () => {
    findFirst.mockResolvedValue(null);
    expect(await readCaseTaskFile("org", "c", "t1", "a.md")).toBeNull();
    expect(findCaseTaskFiles).not.toHaveBeenCalled();
    expect(getLoopAttachment).not.toHaveBeenCalled();
  });

  it("returns null when the file lookup fails", async () => {
    vi.mocked(findCaseTaskFiles).mockResolvedValue(Result.err("nope") as any);
    expect(await readCaseTaskFile("org", "c", "t1", "a.md")).toBeNull();
    expect(getLoopAttachment).not.toHaveBeenCalled();
  });

  it("serves an unknown extension as octet-stream", async () => {
    vi.mocked(findCaseTaskFiles).mockResolvedValue(stored("a.xyz") as any);
    const file = await readCaseTaskFile("org", "c", "t1", "a.xyz");
    expect(file?.contentType).toBe("application/octet-stream");
  });

  it("keeps a markdown type", async () => {
    vi.mocked(findCaseTaskFiles).mockResolvedValue(stored("a.md") as any);
    const file = await readCaseTaskFile("org", "c", "t1", "a.md");
    expect(file?.contentType).toBe("text/markdown; charset=utf-8");
  });
});
