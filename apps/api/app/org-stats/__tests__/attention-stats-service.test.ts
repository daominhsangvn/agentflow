import {
  OrchestratorCaseStatus,
  OrchestratorMessageKind,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import {
  type OrgAttentionItem,
  OrgAttentionKind,
} from "@repo/api/src/types/org-stats";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attentionStatsService,
  mergeAttentionItems,
} from "@/app/org-stats/attention-stats-service";

const ORG = "org-1";
const NOW = new Date("2026-10-30T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
  conversationFindMany: vi.fn(),
  decisionFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  taskGroupBy: vi.fn(),
  taskCount: vi.fn(),
  runCount: vi.fn(),
  messageCount: vi.fn(),
  fleetList: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorConversation: { findMany: mocks.conversationFindMany },
      orchestratorDecision: { findMany: mocks.decisionFindMany },
      orchestratorTask: {
        findMany: mocks.taskFindMany,
        groupBy: mocks.taskGroupBy,
        count: mocks.taskCount,
      },
      workflowRun: { count: mocks.runCount },
      orchestratorMessage: { count: mocks.messageCount },
    }),
}));

vi.mock("@/app/compute-targets/fleet-service", () => ({
  computeTargetFleetService: { list: mocks.fleetList },
}));

function item(since: string, title = since): OrgAttentionItem {
  return {
    kind: OrgAttentionKind.WaitingForHuman,
    title,
    detail: null,
    caseId: null,
    computeTargetId: null,
    projectName: null,
    workflowName: null,
    since,
  };
}

describe("mergeAttentionItems", () => {
  it("sorts oldest first and caps", () => {
    const merged = mergeAttentionItems(
      [
        [item("2026-10-29T00:00:00.000Z")],
        [item("2026-10-27T00:00:00.000Z"), item("2026-10-28T00:00:00.000Z")],
      ],
      2
    );
    expect(merged.map((i) => i.since)).toEqual([
      "2026-10-27T00:00:00.000Z",
      "2026-10-28T00:00:00.000Z",
    ]);
  });
});

describe("attentionStatsService.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversationFindMany.mockResolvedValue([]);
    mocks.decisionFindMany.mockResolvedValue([]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.taskGroupBy.mockResolvedValue([
      { status: OrchestratorTaskStatus.Succeeded, _count: { _all: 10 } },
      { status: OrchestratorTaskStatus.Failed, _count: { _all: 2 } },
    ]);
    mocks.taskCount.mockResolvedValue(3);
    mocks.runCount.mockResolvedValue(4);
    mocks.messageCount.mockResolvedValue(5);
    mocks.fleetList.mockResolvedValue({ agents: [] });
  });

  it("subtracts BLOCKED tasks from succeeded", async () => {
    const stats = await attentionStatsService.get(ORG, NOW);

    expect(stats.tasks7d).toEqual({ succeeded: 7, failed: 2, blocked: 3 });
    expect(stats.failedRuns7d).toBe(4);
    expect(stats.guardRefusals7d).toBe(5);
  });

  it("lists only offline agents used by enabled workflows", async () => {
    const base = {
      machineName: "m",
      displayName: null,
      lastSeen: "2026-10-20T00:00:00.000Z",
    };
    mocks.fleetList.mockResolvedValue({
      agents: [
        { ...base, id: "a", isOnline: false, enabledWorkflowCount: 1 },
        { ...base, id: "b", isOnline: true, enabledWorkflowCount: 1 },
        { ...base, id: "c", isOnline: false, enabledWorkflowCount: 0 },
      ],
    });

    const stats = await attentionStatsService.get(ORG, NOW);

    expect(stats.items).toHaveLength(1);
    expect(stats.items[0]).toMatchObject({
      kind: OrgAttentionKind.OfflineAgent,
      computeTargetId: "a",
    });
  });

  it("scopes queries to the org and open cases", async () => {
    await attentionStatsService.get(ORG, NOW);

    expect(mocks.conversationFindMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      case: { status: OrchestratorCaseStatus.Open },
    });
    expect(mocks.messageCount.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      kind: OrchestratorMessageKind.ToolRefused,
    });
  });

  it("maps failed and blocked tasks to their kinds", async () => {
    const caseRef = { id: "c1", title: "T", project: null, workflow: null };
    mocks.taskFindMany.mockResolvedValue([
      {
        status: OrchestratorTaskStatus.Failed,
        command: "build",
        finishedAt: NOW,
        case: caseRef,
      },
      {
        status: OrchestratorTaskStatus.Succeeded,
        command: "test",
        finishedAt: NOW,
        case: caseRef,
      },
    ]);

    const stats = await attentionStatsService.get(ORG, NOW);

    expect(stats.items.map((i) => i.kind).sort()).toEqual([
      OrgAttentionKind.BlockedTask,
      OrgAttentionKind.FailedTask,
    ]);
  });
});
