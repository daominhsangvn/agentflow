import { AgentWorkflowRole } from "@repo/api/src/types/agent-fleet";
import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentDetailService } from "@/app/compute-targets/agent-detail-service";

const ORG = "org-1";
const TARGET = "t-1";
const NOW = new Date("2026-10-30T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
  targetFindFirst: vi.fn(),
  capabilityFindMany: vi.fn(),
  projectFindMany: vi.fn(),
  workflowFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  taskGroupBy: vi.fn(),
  taskCount: vi.fn(),
  loopFindMany: vi.fn(),
  loopGroupBy: vi.fn(),
  loadLoopUsage: vi.fn(),
  loadWindowedUsage: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      computeTarget: { findFirst: mocks.targetFindFirst },
      computeTargetCapabilities: { findMany: mocks.capabilityFindMany },
      project: { findMany: mocks.projectFindMany },
      workflow: { findMany: mocks.workflowFindMany },
      orchestratorTask: {
        findMany: mocks.taskFindMany,
        groupBy: mocks.taskGroupBy,
        count: mocks.taskCount,
      },
      loop: { findMany: mocks.loopFindMany, groupBy: mocks.loopGroupBy },
    }),
}));

vi.mock("@/lib/usage/loop-usage", () => ({
  loadLoopUsage: mocks.loadLoopUsage,
}));
vi.mock("@/lib/usage/usage-windows", () => ({
  loadWindowedUsage: mocks.loadWindowedUsage,
}));

const usage = {
  inputTokens: 7,
  outputTokens: 3,
  costUsd: 0.5,
  activeMs: 60_000,
};

const target = {
  id: TARGET,
  machineName: "someone-elses-laptop",
  isOnline: true,
  isSharedWithOrg: false,
  lastSeenAt: NOW,
  capabilities: { personalRunner: {} },
  modelProvider: null,
  user: { firstName: "Ada", lastName: "L" },
  healthCheck: {
    checkedAt: NOW,
    allRequiredPassed: false,
    requiredFailureIds: ["gh"],
    result: {
      checks: [
        { id: "gh", label: "GitHub CLI", required: true, passed: false },
      ],
    },
  },
};

describe("agentDetailService.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.targetFindFirst.mockResolvedValue(target);
    mocks.capabilityFindMany.mockResolvedValue([]);
    mocks.projectFindMany.mockResolvedValue([
      { id: "p1", name: "Project", settings: { runnerIds: [TARGET] } },
    ]);
    mocks.workflowFindMany.mockResolvedValue([
      {
        id: "w1",
        name: "Flow",
        projectId: "p1",
        agentConfig: { mode: WorkflowAgentMode.Orchestrated },
      },
    ]);
    mocks.taskFindMany.mockResolvedValue([
      {
        id: "task-1",
        command: "build",
        status: OrchestratorTaskStatus.Succeeded,
        result: null,
        loopId: "l1",
        createdAt: NOW,
        finishedAt: NOW,
        case: { id: "c1", title: "Case" },
      },
    ]);
    mocks.loopFindMany.mockResolvedValue([]);
    mocks.taskGroupBy.mockResolvedValue([]);
    mocks.taskCount.mockResolvedValue(0);
    mocks.loopGroupBy.mockResolvedValue([]);
    mocks.loadWindowedUsage.mockResolvedValue({
      last7d: usage,
      last30d: usage,
      byAgent: new Map(),
    });
    mocks.loadLoopUsage.mockResolvedValue(new Map([["l1", usage]]));
  });

  it("returns null for an unknown, sentinel or other-org target", async () => {
    mocks.targetFindFirst.mockResolvedValue(null);

    expect(await agentDetailService.get(ORG, TARGET, NOW)).toBeNull();
    expect(mocks.targetFindFirst.mock.calls[0][0].where).toEqual({
      id: TARGET,
      organizationId: ORG,
      isCloudSentinel: false,
    });
    expect(mocks.taskFindMany).not.toHaveBeenCalled();
  });

  it("returns another member's personal agent with its work and usage", async () => {
    const detail = await agentDetailService.get(ORG, TARGET, NOW);

    expect(detail?.agent.machineName).toBe("someone-elses-laptop");
    expect(detail?.agent.kind).toBe("personal");
    expect(detail?.healthTools).toEqual([
      {
        id: "gh",
        label: "GitHub CLI",
        required: true,
        passed: false,
        version: null,
      },
    ]);
    expect(detail?.projects).toEqual([{ id: "p1", name: "Project" }]);
    expect(detail?.workflows).toEqual([
      {
        id: "w1",
        name: "Flow",
        projectId: "p1",
        projectName: "Project",
        mode: WorkflowAgentMode.Orchestrated,
        roles: [AgentWorkflowRole.ProjectAgent],
      },
    ]);
    expect(detail?.recentWork[0]).toMatchObject({
      id: "task-1",
      inputTokens: 7,
      outputTokens: 3,
      costUsd: 0.5,
    });
    expect(detail?.usage.last7d.inputTokens).toBe(7);
    expect(mocks.loadLoopUsage).toHaveBeenCalledWith(ORG, ["l1"], NOW);
    expect(mocks.loadWindowedUsage).toHaveBeenCalledWith(ORG, {
      now: NOW,
      computeTargetId: TARGET,
    });
  });
});
