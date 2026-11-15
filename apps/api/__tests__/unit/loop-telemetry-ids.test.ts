import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWithDb } = vi.hoisted(() => ({ mockWithDb: vi.fn() }));

vi.mock("@repo/observability/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@repo/database", () => ({
  withDb: mockWithDb,
}));

import { AfAttribute } from "@repo/observability/af-attributes";
import { resolveLoopTelemetryIds } from "@/lib/loops/loop-telemetry-ids";

function mockQueries(task: unknown, workflowRunLoop: unknown) {
  mockWithDb.mockImplementation((callback: (db: unknown) => unknown) =>
    callback({
      orchestratorTask: { findUnique: vi.fn().mockResolvedValue(task) },
      workflowRunLoop: {
        findUnique: vi.fn().mockResolvedValue(workflowRunLoop),
      },
    })
  );
}

describe("resolveLoopTelemetryIds", () => {
  beforeEach(() => {
    mockWithDb.mockReset();
  });

  it("maps task and workflow run ids", async () => {
    mockQueries(
      {
        id: "task-1",
        caseId: "case-1",
        turnId: "turn-1",
        case: { projectId: "project-1" },
      },
      { runId: "run-1" }
    );

    await expect(resolveLoopTelemetryIds("loop-1")).resolves.toEqual({
      [AfAttribute.TaskId]: "task-1",
      [AfAttribute.CaseId]: "case-1",
      [AfAttribute.TurnId]: "turn-1",
      [AfAttribute.ProjectId]: "project-1",
      [AfAttribute.WorkflowRunId]: "run-1",
    });
  });

  it("omits ids that do not exist", async () => {
    mockQueries(null, null);

    await expect(resolveLoopTelemetryIds("loop-1")).resolves.toEqual({});
  });

  it("returns no ids when the lookup fails", async () => {
    mockWithDb.mockRejectedValue(new Error("db down"));

    await expect(resolveLoopTelemetryIds("loop-1")).resolves.toEqual({});
  });
});
