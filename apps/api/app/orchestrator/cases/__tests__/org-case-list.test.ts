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
  foldCaseAgents,
  loadCaseWaitState,
  loadOrgCaseRows,
} from "@/app/orchestrator/cases/service/org-case-list";
import { caseNeedsPersonWhere } from "@/lib/orchestrator/case-needs-person";

const ORG = "org-1";
const NOW = new Date("2026-11-01T10:00:00.000Z");

const mocks = vi.hoisted(() => ({
  caseFindMany: vi.fn(),
  conversationFindMany: vi.fn(),
  waitFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  taskGroupBy: vi.fn(),
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
      orchestratorTask: {
        findMany: mocks.taskFindMany,
        groupBy: mocks.taskGroupBy,
      },
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
  needsPerson: false,
  wakeDue: false,
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
        needsPerson: true,
      })
    ).toBe(OrchestratorCaseWaitingFor.Tasks);
  });

  it("is Turn when a scheduled wake has passed", () => {
    expect(
      deriveCaseWaitingFor({ ...base, wakeDue: true, needsPerson: true })
    ).toBe(OrchestratorCaseWaitingFor.Turn);
  });

  it("is Human only for a case that needs a person, NextMessage otherwise", () => {
    expect(deriveCaseWaitingFor({ ...base, needsPerson: true })).toBe(
      OrchestratorCaseWaitingFor.Human
    );
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
    const state = await loadCaseWaitState(ORG, [], NOW);

    expect(state.agents.size).toBe(0);
    expect(mocks.conversationFindMany).not.toHaveBeenCalled();
    expect(mocks.waitFindMany).not.toHaveBeenCalled();
    expect(mocks.taskFindMany).not.toHaveBeenCalled();
    expect(mocks.taskGroupBy).not.toHaveBeenCalled();
  });

  it("collects waits and dedupes sorted agent names", async () => {
    mocks.taskGroupBy.mockResolvedValue([]);
    mocks.conversationFindMany.mockResolvedValue([
      { caseId: "a", status: OrchestratorConversationStatus.Waiting },
    ]);
    mocks.waitFindMany.mockResolvedValue([{ conversation: { caseId: "b" } }]);
    mocks.taskFindMany.mockResolvedValue([
      { caseId: "a", computeTarget: { machineName: "zed" } },
      { caseId: "a", computeTarget: { machineName: "alpha" } },
      { caseId: "a", computeTarget: { machineName: "zed" } },
      { caseId: "b", computeTarget: null },
    ]);

    const state = await loadCaseWaitState(ORG, ["a", "b"], NOW);

    expect(state.waitingConversation.has("a")).toBe(true);
    expect(state.openWait.has("b")).toBe(true);
    expect(state.agents.get("a")).toEqual(["alpha", "zed"]);
    expect(state.agents.has("b")).toBe(false);
    expect(mocks.conversationFindMany.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      caseId: { in: ["a", "b"] },
      OR: [
        { status: OrchestratorConversationStatus.Waiting },
        { askedHuman: { not: null } },
        { nextWakeAt: { not: null } },
      ],
    });
    expect(mocks.taskFindMany.mock.calls[0][0].where.status).toEqual({
      in: [OrchestratorTaskStatus.Queued, OrchestratorTaskStatus.Running],
    });
  });
});

describe("loadCaseWaitState asked and due", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitFindMany.mockResolvedValue([]);
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.taskGroupBy.mockResolvedValue([]);
  });

  it("keeps the newest asked of a case and flags a wake that is due", async () => {
    mocks.conversationFindMany.mockResolvedValue([
      {
        caseId: "a",
        status: OrchestratorConversationStatus.Idle,
        askedHuman: "newest",
        nextWakeAt: null,
      },
      {
        caseId: "a",
        status: OrchestratorConversationStatus.Waiting,
        askedHuman: "older",
        nextWakeAt: null,
      },
      {
        caseId: "b",
        status: OrchestratorConversationStatus.Idle,
        askedHuman: null,
        nextWakeAt: new Date(NOW.getTime() - 1000),
      },
      {
        caseId: "c",
        status: OrchestratorConversationStatus.Idle,
        askedHuman: null,
        nextWakeAt: new Date(NOW.getTime() + 1000),
      },
    ]);

    const state = await loadCaseWaitState(ORG, ["a", "b", "c"], NOW);

    expect(state.askedHuman.get("a")).toBe("newest");
    expect(state.askedHuman.has("b")).toBe(false);
    expect(state.wakeDue.has("b")).toBe(true);
    expect(state.wakeDue.has("c")).toBe(false);
  });

  it("folds the task groups into the case's agents", async () => {
    mocks.conversationFindMany.mockResolvedValue([]);
    mocks.taskGroupBy.mockResolvedValue([
      group("a", "t2", OrchestratorTaskStatus.Running, 1, 0),
    ]);

    const state = await loadCaseWaitState(ORG, ["a"], NOW);

    expect(state.caseAgents.get("a")).toEqual([
      { computeTargetId: "t2", activeTaskCount: 1, openQuestionCount: 0 },
    ]);
    expect(mocks.taskGroupBy.mock.calls[0][0].where).toEqual({
      organizationId: ORG,
      caseId: { in: ["a"] },
      computeTargetId: { not: null },
    });
  });
});

describe("foldCaseAgents", () => {
  it("sums active tasks and open questions per agent, sorted by id", () => {
    const folded = foldCaseAgents([
      group("a", "t2", OrchestratorTaskStatus.Queued, 1, 0),
      group("a", "t2", OrchestratorTaskStatus.Running, 2, 0),
      group("a", "t2", OrchestratorTaskStatus.Succeeded, 3, 1),
      group("a", "t1", OrchestratorTaskStatus.Succeeded, 1, 2),
      group("a", null, OrchestratorTaskStatus.Succeeded, 1, 5),
      group("b", "t1", OrchestratorTaskStatus.Failed, 1, null),
    ]);

    expect(folded.get("a")).toEqual([
      { computeTargetId: "t1", activeTaskCount: 0, openQuestionCount: 2 },
      { computeTargetId: "t2", activeTaskCount: 3, openQuestionCount: 1 },
    ]);
    expect(folded.get("b")).toEqual([
      { computeTargetId: "t1", activeTaskCount: 0, openQuestionCount: 0 },
    ]);
  });
});

describe("loadOrgCaseRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.caseFindMany.mockResolvedValue([]);
  });

  it("scopes by organization, passes the filters and composes needs-person by AND", async () => {
    await loadOrgCaseRows(ORG, {
      projectId: "p1",
      workflowId: "w1",
      status: OrchestratorCaseStatus.Closed,
    });

    const recent = mocks.caseFindMany.mock.calls.find(
      ([args]) => !args.where.AND
    );
    const needsPerson = mocks.caseFindMany.mock.calls.find(
      ([args]) => args.where.AND
    );
    const base = {
      organizationId: ORG,
      projectId: "p1",
      workflowId: "w1",
      status: OrchestratorCaseStatus.Closed,
    };
    expect(recent?.[0].where).toEqual(base);
    expect(needsPerson?.[0].where).toEqual({
      AND: [base, caseNeedsPersonWhere()],
    });
    expect(recent?.[0].take).toBe(100);
    expect(needsPerson?.[0].take).toBe(100);
  });

  it("filters by organization only without a query", async () => {
    await loadOrgCaseRows(ORG, {});

    expect(mocks.caseFindMany.mock.calls[0][0].where).toEqual({
      AND: [{ organizationId: ORG }, caseNeedsPersonWhere()],
    });
    expect(mocks.caseFindMany.mock.calls[1][0].where).toEqual({
      organizationId: ORG,
    });
  });

  it("lists the needs-person cases first, then the recent ones without repeats", async () => {
    const recent = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` }));
    mocks.caseFindMany.mockImplementation(
      (args: { where: { AND?: unknown } }) =>
        Promise.resolve(args.where.AND ? [{ id: "old" }, { id: "r3" }] : recent)
    );

    const { rows, needsPerson } = await loadOrgCaseRows(ORG, {});

    expect(rows).toHaveLength(101);
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(["old", "r3"]);
    expect(rows.filter((row) => row.id === "r3")).toHaveLength(1);
    expect(needsPerson).toEqual(new Set(["old", "r3"]));
  });
});

describe("orchestratorCaseService.listForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps waitingFor and runningAgents onto each case", async () => {
    const at = new Date("2026-10-30T10:00:00.000Z");
    mocks.taskGroupBy.mockResolvedValue([
      group("c1", "ct-1", OrchestratorTaskStatus.Running, 1, 1),
    ]);
    mocks.caseFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
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
    mocks.conversationFindMany.mockResolvedValue([
      {
        caseId: "c1",
        status: OrchestratorConversationStatus.Idle,
        askedHuman: "Which policy?",
        nextWakeAt: null,
      },
    ]);
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
      needsPerson: false,
      askedHuman: "Which policy?",
      agents: [
        { computeTargetId: "ct-1", activeTaskCount: 1, openQuestionCount: 1 },
      ],
      inputTokens: 0,
      closedAt: null,
    });
  });
});

function group(
  caseId: string,
  computeTargetId: string | null,
  status: string,
  count: number,
  openQuestionCount: number | null
) {
  return {
    caseId,
    computeTargetId,
    status,
    _count: { _all: count },
    _sum: { openQuestionCount },
  };
}
