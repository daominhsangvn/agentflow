import {
  AgentWorkKind,
  AgentWorkStatus,
} from "@repo/api/src/types/agent-fleet";
import { LoopStatus } from "@repo/api/src/types/loop";
import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { RunnerCommandMode } from "@repo/api/src/types/runner-capabilities";
import { describe, expect, it } from "vitest";
import {
  loopWorkStatus,
  mergeRecentWork,
  type RecentLoopRow,
  type RecentTaskRow,
  taskWorkStatus,
  toCapabilityFile,
  toHealthTools,
  usageWindow,
} from "@/app/compute-targets/agent-detail-mappers";
import type { UsageTotals } from "@/lib/usage/loop-usage";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 30, hour));
const totals: UsageTotals = {
  inputTokens: 10,
  outputTokens: 20,
  costUsd: 1.5,
  activeMs: 1000,
};

describe("toHealthTools", () => {
  it("maps checks and defaults a missing version to null", () => {
    expect(
      toHealthTools({
        checks: [
          {
            id: "git",
            label: "Git",
            required: true,
            passed: true,
            version: "2.4",
          },
          { id: "gh", label: "GitHub CLI", required: true, passed: false },
        ],
      })
    ).toEqual([
      { id: "git", label: "Git", required: true, passed: true, version: "2.4" },
      {
        id: "gh",
        label: "GitHub CLI",
        required: true,
        passed: false,
        version: null,
      },
    ]);
  });

  it("is empty for a malformed snapshot", () => {
    expect(toHealthTools("nope")).toEqual([]);
    expect(toHealthTools(null)).toEqual([]);
  });
});

describe("toCapabilityFile", () => {
  const row = {
    projectId: "p1",
    source: "personal",
    problems: ["bad"],
    warnings: [],
    uploadedAt: at(9),
    project: { id: "p1", name: "Project" },
  };

  it("reads commands and role from a valid file", () => {
    const file = toCapabilityFile({
      ...row,
      capabilities: {
        runner: "Dev",
        toolkit: null,
        commands: [{ name: "/build", mode: RunnerCommandMode.Write }],
        skills: [],
      },
    });

    expect(file.roleName).toBe("Dev");
    expect(file.commands.map((command) => command.name)).toEqual(["/build"]);
    expect(file.problems).toEqual(["bad"]);
    expect(file.uploaded).toBe(at(9).toISOString());
  });

  it("falls back to no commands when the file does not parse", () => {
    const file = toCapabilityFile({ ...row, capabilities: { commands: 5 } });

    expect(file.roleName).toBeNull();
    expect(file.commands).toEqual([]);
  });
});

describe("work statuses", () => {
  it("marks a succeeded task with a BLOCKED reply as blocked", () => {
    expect(
      taskWorkStatus(OrchestratorTaskStatus.Succeeded, {
        reply: "BLOCKED: no repo",
      })
    ).toBe(AgentWorkStatus.Blocked);
    expect(
      taskWorkStatus(OrchestratorTaskStatus.Succeeded, { reply: "done" })
    ).toBe(AgentWorkStatus.Succeeded);
    expect(taskWorkStatus(OrchestratorTaskStatus.Failed, null)).toBe(
      AgentWorkStatus.Failed
    );
  });

  it("maps every loop status", () => {
    expect(loopWorkStatus(LoopStatus.Pending)).toBe(AgentWorkStatus.Queued);
    expect(loopWorkStatus(LoopStatus.Claimed)).toBe(AgentWorkStatus.Queued);
    expect(loopWorkStatus(LoopStatus.Blocked)).toBe(AgentWorkStatus.Queued);
    expect(loopWorkStatus(LoopStatus.Running)).toBe(AgentWorkStatus.Running);
    expect(loopWorkStatus(LoopStatus.Completed)).toBe(
      AgentWorkStatus.Succeeded
    );
    expect(loopWorkStatus(LoopStatus.Failed)).toBe(AgentWorkStatus.Failed);
    expect(loopWorkStatus(LoopStatus.TimedOut)).toBe(AgentWorkStatus.Failed);
    expect(loopWorkStatus(LoopStatus.Cancelled)).toBe(
      AgentWorkStatus.Cancelled
    );
  });
});

describe("mergeRecentWork", () => {
  const task = (
    id: string,
    hour: number,
    loopId: string | null
  ): RecentTaskRow => ({
    id,
    command: "build",
    status: OrchestratorTaskStatus.Succeeded,
    result: null,
    loopId,
    createdAt: at(hour),
    finishedAt: null,
    case: { id: "c1", title: "Case" },
  });
  const loop = (id: string, hour: number): RecentLoopRow => ({
    id,
    command: "EXECUTE",
    status: LoopStatus.Completed,
    createdAt: at(hour),
    completedAt: at(hour + 1),
    workflowRunLoop: {
      run: { id: "r1", workflowId: "w1", sourceKey: "jira:X-1" },
    },
  });

  it("orders newest first, caps and carries usage", () => {
    const work = mergeRecentWork(
      [task("t1", 8, "l1"), task("t2", 12, null)],
      [loop("l2", 10)],
      new Map([["l1", totals]]),
      2
    );

    expect(work.map((item) => item.id)).toEqual(["t2", "l2"]);
    expect(work[1]).toMatchObject({
      kind: AgentWorkKind.RunLoop,
      runId: "r1",
      workflowId: "w1",
      label: "jira:X-1",
      inputTokens: 0,
      costUsd: null,
    });
  });

  it("gives task rows their case and the loop's usage", () => {
    const [item] = mergeRecentWork(
      [task("t1", 8, "l1")],
      [],
      new Map([["l1", totals]])
    );

    expect(item).toMatchObject({
      kind: AgentWorkKind.Task,
      caseId: "c1",
      caseTitle: "Case",
      label: "Case",
      inputTokens: 10,
      costUsd: 1.5,
    });
  });
});

describe("usageWindow", () => {
  it("excludes BLOCKED from succeeded and counts timed out as failed", () => {
    const window = usageWindow(
      {
        taskCounts: [
          { status: OrchestratorTaskStatus.Succeeded, _count: { _all: 5 } },
          { status: OrchestratorTaskStatus.Failed, _count: { _all: 1 } },
        ],
        blocked: 2,
        loopCounts: [
          { status: LoopStatus.Completed, _count: { _all: 3 } },
          { status: LoopStatus.Failed, _count: { _all: 1 } },
          { status: LoopStatus.TimedOut, _count: { _all: 2 } },
        ],
      },
      totals
    );

    expect(window).toEqual({
      tasks: 12,
      succeeded: 6,
      failed: 4,
      blocked: 2,
      activeMs: 1000,
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 1.5,
    });
  });
});
