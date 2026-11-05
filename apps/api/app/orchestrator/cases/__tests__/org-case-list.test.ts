import {
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
  OrchestratorConversationStatus,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorCaseService } from "@/app/orchestrator/cases/service";
import {
  deriveCaseWaitingFor,
  loadCaseWaitState,
  loadOrgCaseRows,
} from "@/app/orchestrator/cases/service/org-case-list";

const ORG = "org-1";

const mocks = vi.hoisted(() => ({
  caseFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  waitFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  turnFindMany: vi.fn(),
  loadCaseStats: vi.fn(),
}));

vi.mock("@/app/orchestrator/cases/service/case-messages", () => ({
  postCaseMessage: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      orchestratorCase: { findMany: mocks.caseFindMany },
      orchestratorConversation: { findMany: mocks.conversationFindMany },
      orchestratorWait: { findMany: mocks.waitFindMany },
      orchestratorTask: { findMany: mocks.taskFindMany },
      orchestratorTurn: { findMany: mocks.turnFindMany },
    }),
}));

vi.mock("@/app/orchestrator/cases/service/case-stats", () => ({
  loadCaseStats: mocks.loadCaseStats,
}));

vi.mock("@/lib/orchestrator/case-documents", () => ({
  listCaseDocuments: vi.fn(),
}));

vi.mock("@/lib/loops/loop-desktop", () => ({
  dispatchOrchestratorTurnCancel: vi.fn(),
}));

const base = {
  status: OrchestratorCaseStatus.Open,
  turnRunning: false,
  pendingDecisionCount: 0,
  activeTaskCount: 0,
  hasOpenWait: false,
  hasWaitingConversation: false,
};

describe("deriveCaseWaitingFor", () => {
  it("is Nothing for a closed case, even with a running turn", () => {
    expect(
      deriveCaseWaitingFor({
        ...base,
        status: OrchestratorCaseStatus.Closed,
        turnRunning: true,
      })
    ).toBe(OrchestratorCaseWaitingFor.Nothing);
  });

  it("is Turn while a turn runs", () => {
    expect(
      deriveCaseWaitingFor({
        ...base,
        turnRunning: true,
        pendingDecisionCount: 1,
      })
    ).toBe(OrchestratorCaseWaitingFor.Turn);
  });

  it("puts a pending decision before tasks", () => {
    expect(
      deriveCaseWaitingFor({
        ...base,
        pendingDecisionCount: 1,
        activeTaskCount: 2,
      })
    ).toBe(OrchestratorCaseWaitingFor.Decision);
  });

  it("is Tasks for an open wait or active tasks", () => {
    expect(deriveCaseWaitingFor({ ...base, hasOpenWait: true })).toBe(
      OrchestratorCaseWaitingFor.Tasks
    );
    expect(
      deriveCaseWaitingFor({
        ...base,
        activeTaskCount: 1,
        hasWaitingConversation: true,
      })
    ).toBe(OrchestratorCaseWaitingFor.Tasks);
  });

  it("is Human for a waiting conversation and NextMessage otherwise", () => {
    expect(
      deriveCaseWaitingFor({ ...base, hasWaitingConversation: true })
    ).toBe(OrchestratorCaseWaitingFor.Human);
    expect(deriveCaseWaitingFor(base)).toBe(
      OrchestratorCaseWaitingFor.NextMessage
    );
  });
});

describe("loadCaseWaitState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("makes no query for no cases", async () => {
    const state = await loadCaseWaitState(ORG, []);

    expect(state.agents.size).toBe(0);
    expect(mocks.conversationFindMany).not.toHaveBeenCalled();
    expect(mocks.waitFindMany).not.toHaveBeenCalled();
    expect(mocks.taskFindMany).not.toHaveBeenCalled();
  });

  it("collects waits and dedupes sorted agent names", async () => {
    mocks.conversationFindMany.mockResolvedValue([{ caseId: "a" }]);
    mocks.waitFindMany.mockResolvedValue([{ conversation: { caseId: "b" } }]);
    mocks.taskFindMany.mockResolvedValue([
      { caseId: "a", computeTarget: { machineName: "zed" } },
      { caseId: "a", computeTarget: { machineName: "alpha" } },
      { caseId: "a", computeTarget: { machineName: "zed" } },
      { caseId: "b", computeTarget: null },
    ]);

    const state = await loadCaseWaitState(ORG, ["a", "b"]);

    expect(state.waitingConversation.has("a")).toBe(true);
    expect(state.openWait.has("b")).toBe(true);
    expect(state.agents.get("a")).toEqual(["alpha", "zed"]);
    expect(state.agents.has("b")).toBe(false);
    expect(mocks.conversationFindMany.mock.calls[0][0].where.status).toBe(
      OrchestratorConversationStatus.Waiting
    );
    expect(mocks.taskFindMany.mock.calls[0][0].where.status).toEqual({
      in: [OrchestratorTaskStatus.Queued, OrchestratorTaskStatus.Running],
    });
  });
});

describe("loadOrgCaseRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.caseFindMany.mockResolvedValue([]);
  });

  it("scopes by organization and passes the filters", async () => {
    await loadOrgCaseRows(ORG, {
      projectId: "p1",
      workflowId: "w1",
      status: OrchestratorCaseStatus.Open,
    });

    expect(mocks.caseFindMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      projectId: "p1",
      workflowId: "w1",
      status: OrchestratorCaseStatus.Open,
    });
    expect(mocks.caseFindMany.mock.calls[0][0].take).toBe(100);
  });

  it("filters by organization only without a query", async () => {
    await loadOrgCaseRows(ORG, {});

    expect(mocks.caseFindMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
    });
  });
});

describe("orchestratorCaseService.listForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps waitingFor and runningAgents onto each case", async () => {
    const at = new Date("2026-10-30T10:00:00.000Z");
    mocks.caseFindMany.mockResolvedValue([
      {
        id: "c1",
        projectId: "p1",
        workflowId: "w1",
        title: "Case",
        sourceKey: null,
        status: OrchestratorCaseStatus.Open,
        createdAt: at,
        updatedAt: at,
        closedAt: null,
        project: { id: "p1", name: "Project" },
        workflow: { id: "w1", name: "Flow" },
        _count: {
          conversations: 1,
          decisions: 0,
          tasks: 1,
        },
      },
    ]);
    mocks.turnFindMany.mockResolvedValue([]);
    mocks.loadCaseStats.mockResolvedValue(new Map());
    mocks.conversationFindMany.mockResolvedValue([]);
    mocks.waitFindMany.mockResolvedValue([]);
    mocks.taskFindMany.mockResolvedValue([
      { caseId: "c1", computeTarget: { machineName: "runner-1" } },
    ]);

    const [item] = await orchestratorCaseService.listForOrg(ORG, {});

    expect(item).toMatchObject({
      id: "c1",
      project: { id: "p1", name: "Project" },
      workflow: { id: "w1", name: "Flow" },
      waitingFor: OrchestratorCaseWaitingFor.Tasks,
      runningAgents: ["runner-1"],
      inputTokens: 0,
      closedAt: null,
    });
  });
});
