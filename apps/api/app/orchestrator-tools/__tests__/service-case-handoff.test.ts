import {
  OrchestratorCaseStatus,
  OrchestratorDecisionStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";
import { TURN_SUPERSEDED_ERROR } from "@/lib/orchestrator/supersede";
import { waitUntil } from "@/lib/wait-until";

/** case_handoff sends an approved decision's question to another item's case. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";
const DECISION_ID = "0199a5f0-0000-7000-8000-0000000000d1";
const CASE_2 = "0199a5f0-0000-7000-8000-0000000000c2";
const CASE_3 = "0199a5f0-0000-7000-8000-0000000000c3";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  cases: [] as Row[],
  conversations: [] as Row[],
  decision: null as Row | null,
  existingMessage: null as Row | null,
  decisionFind: vi.fn(),
  caseUpdates: [] as Row[],
  conversationUpdates: [] as Row[],
  turnSuperseded: vi.fn(),
  caseHandoff: true,
  enabled: true,
  debounceSeconds: 20,
  createError: null as unknown,
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTurn: {
      findFirst: () =>
        Promise.resolve({
          id: "turn-1",
          organizationId: "org-1",
          tokenHash: hashOrchestratorToken(TOKEN),
          conversation: {
            id: "conversation-1",
            projectId: "project-1",
            caseId: "case-1",
            projectConnectionId: null,
            case: { workflowId: "workflow-1" },
            channel: {
              item: {
                provider: "microsoft_teams",
                externalId: "t1",
                key: "teams-thread-1",
                url: "https://teams.example/t1",
                title: "Leave questions",
                container: null,
              },
              parentId: null,
              extras: null,
            },
          },
        }),
    },
    orchestratorDecision: {
      findFirst: (args: unknown) => {
        mocks.decisionFind(args);
        return Promise.resolve(mocks.decision);
      },
    },
    orchestratorMessage: {
      findFirst: () => Promise.resolve(mocks.existingMessage),
      create: (args: { data: Row }) => {
        if (
          mocks.createError &&
          args.data.kind !== OrchestratorMessageKind.ToolRefused
        ) {
          return Promise.reject(mocks.createError);
        }
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    orchestratorCase: {
      findMany: () => Promise.resolve(mocks.cases),
      updateMany: (args: Row) => {
        mocks.caseUpdates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
    orchestratorConversation: {
      findMany: () => Promise.resolve(mocks.conversations),
      updateMany: (args: Row) => {
        mocks.conversationUpdates.push(args);
        return Promise.resolve({ count: 1 });
      },
    },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
  };
  const withDb = (fn: (client: unknown) => unknown) => fn(db);
  withDb.tx = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb };
});
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return {
    loadOrchestratorWorkflows: async () => {
      const map = await workflowsWith({});
      return new Map([
        [
          "workflow-1",
          {
            ...map.get("workflow-1"),
            caseLookup: false,
            caseHandoff: mocks.caseHandoff,
            enabled: mocks.enabled,
            debounceSeconds: mocks.debounceSeconds,
          },
        ],
        [
          "workflow-2",
          {
            enabled: mocks.enabled,
            debounceSeconds: mocks.debounceSeconds,
          },
        ],
      ]);
    },
  };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: () => mocks.turnSuperseded(),
}));
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceConversation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/orchestrator/case-render", () => ({
  renderCase: (id: string) => Promise.resolve(`# case ${id}`),
}));
vi.mock("@/lib/orchestrator/tasks", () => ({ startTask: vi.fn() }));
vi.mock("@/lib/orchestrator/task-cancel", () => ({ cancelTask: vi.fn() }));
vi.mock("@/lib/orchestrator/decisions", () => ({
  requestDecision: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@/lib/orchestrator/waits", () => ({
  createWait: vi.fn(),
  evaluateWaits: vi.fn(),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () => Promise.resolve(null),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: {
    listForProject: () => Promise.resolve([]),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.caseUpdates = [];
  mocks.conversationUpdates = [];
  mocks.cases = [targetCase(CASE_2, OrchestratorCaseStatus.Open)];
  mocks.conversations = [
    { id: "conversation-9", channelKey: "jira:LD-6:comment:9" },
    { id: "conversation-2", channelKey: "jira:LD-6:item" },
  ];
  mocks.decision = {
    id: DECISION_ID,
    conversationId: "conversation-1",
    question: "Change LD-6: leave needs 2 approvers.",
    status: OrchestratorDecisionStatus.Approved,
    decidedBy: "Ana",
  };
  mocks.existingMessage = null;
  mocks.caseHandoff = true;
  mocks.enabled = true;
  mocks.debounceSeconds = 20;
  mocks.createError = null;
  mocks.turnSuperseded.mockResolvedValue(false);
});

function targetCase(id: string, status: string) {
  return {
    id,
    status,
    title: "Leave",
    sourceKey: "jira:LD-6",
    workflowId: "workflow-2",
    workflow: { name: id === CASE_3 ? "QC" : "Dev" },
  };
}

async function handoff(input: Record<string, unknown>) {
  const result = await orchestratorToolService.call(
    TOKEN,
    OrchestratorToolName.CaseHandoff,
    input as never
  );
  if (!result.ok) {
    throw new Error("unauthorized");
  }
  return result.value;
}

function handoffs() {
  return mocks.messages.filter(
    (m) => m.kind === OrchestratorMessageKind.Handoff
  );
}

const SEND = { decisionId: DECISION_ID, itemKey: "LD-6" };

describe("case_handoff", () => {
  it("is hidden and refused when off", async () => {
    mocks.caseHandoff = false;
    const described = await orchestratorToolService.describe(TOKEN);
    const names = described.ok ? described.value.tools.map((t) => t.name) : [];
    expect(names).not.toContain(OrchestratorToolName.CaseHandoff);
    const outcome = await handoff(SEND);
    expect(outcome.ok).toBe(false);
    expect(handoffs()).toHaveLength(0);
  });

  it("refuses a pending and a rejected decision", async () => {
    for (const status of [
      OrchestratorDecisionStatus.Pending,
      OrchestratorDecisionStatus.Rejected,
    ]) {
      mocks.decision = { ...mocks.decision, status };
      const outcome = await handoff(SEND);
      expect(outcome.ok).toBe(false);
    }
    expect(handoffs()).toHaveLength(0);
    expect(
      mocks.messages.some((m) => m.kind === OrchestratorMessageKind.HandoffSent)
    ).toBe(false);
  });

  it("looks the decision up in this case and organization", async () => {
    await handoff(SEND);
    expect(mocks.decisionFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DECISION_ID, organizationId: "org-1", caseId: "case-1" },
      })
    );
  });

  it("writes the decision's question into the item conversation", async () => {
    const outcome = await handoff(SEND);
    expect(outcome).toMatchObject({
      ok: true,
      output: { sentTo: "LD-6", caseId: CASE_2 },
    });
    expect(outcome.ok && (outcome.output as Row).caseUrl).toBeTruthy();
    expect(handoffs()).toEqual([
      expect.objectContaining({
        conversationId: "conversation-2",
        origin: OrchestratorMessageOrigin.Internal,
        text: expect.stringContaining("Change LD-6: leave needs 2 approvers."),
        payload: expect.objectContaining({
          fromCaseId: "case-1",
          decisionId: DECISION_ID,
          approvedBy: "Ana",
        }),
      }),
    ]);
    expect(handoffs()[0].text).toContain("approved by Ana");
    expect(handoffs()[0]).not.toHaveProperty("turnId");
    const sent = mocks.messages.find(
      (m) => m.kind === OrchestratorMessageKind.HandoffSent
    );
    expect(sent).toMatchObject({
      conversationId: "conversation-1",
      turnId: "turn-1",
    });
  });

  it("refuses a decision that was already handed off", async () => {
    mocks.existingMessage = { id: "m1" };
    const outcome = await handoff(SEND);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).toContain("already handed off");
    expect(handoffs()).toHaveLength(0);
  });

  it("treats a unique violation as already handed off", async () => {
    mocks.createError = { code: "P2002" };
    const outcome = await handoff(SEND);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).toContain("already handed off");
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("asks for caseId when several cases are about the item", async () => {
    mocks.cases = [
      targetCase(CASE_2, OrchestratorCaseStatus.Open),
      targetCase(CASE_3, OrchestratorCaseStatus.Open),
    ];
    const outcome = await handoff(SEND);
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).toContain(CASE_2);
    expect(JSON.stringify(outcome)).toContain(CASE_3);
    expect(handoffs()).toHaveLength(0);
    const chosen = await handoff({ ...SEND, caseId: CASE_3 });
    expect(chosen).toMatchObject({ ok: true, output: { caseId: CASE_3 } });
  });

  it("reopens a closed target and wakes it at once without a debounce", async () => {
    mocks.cases = [targetCase(CASE_2, OrchestratorCaseStatus.Closed)];
    mocks.debounceSeconds = 0;
    const outcome = await handoff(SEND);
    expect(outcome).toMatchObject({ ok: true, output: { reopened: true } });
    expect(mocks.caseUpdates).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          status: OrchestratorCaseStatus.Closed,
        }),
      }),
    ]);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("refuses the conversation's own item", async () => {
    const outcome = await handoff({ ...SEND, itemKey: "TEAMS-THREAD-1" });
    expect(outcome.ok).toBe(false);
    expect(mocks.decisionFind).not.toHaveBeenCalled();
  });

  it("refuses when the turn is superseded", async () => {
    mocks.turnSuperseded.mockResolvedValue(true);
    const outcome = await handoff(SEND);
    expect(outcome).toMatchObject({ ok: false, error: TURN_SUPERSEDED_ERROR });
    expect(handoffs()).toHaveLength(0);
  });
});
