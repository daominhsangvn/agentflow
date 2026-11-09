import {
  OrchestratorCaseStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";
import { advanceConversation } from "@/lib/orchestrator/advance";
import { TURN_SUPERSEDED_ERROR } from "@/lib/orchestrator/supersede";
import { waitUntil } from "@/lib/wait-until";

/** case_notify wakes the case of another item of the same workflow. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  targetCase: null as Row | null,
  conversations: [] as Row[],
  caseFind: vi.fn(),
  conversationUpdates: [] as Row[],
  caseUpdates: [] as Row[],
  turnSuperseded: vi.fn(),
  noChannel: false,
  debounceSeconds: 0,
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
            projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
            case: { workflowId: "workflow-1" },
            channel: mocks.noChannel
              ? null
              : {
                  item: {
                    provider: "jira",
                    externalId: "10001",
                    key: "LD-7",
                    url: null,
                    title: "Half-day leave",
                    container: "LD",
                  },
                  parentId: null,
                  extras: null,
                },
          },
        }),
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        if (
          mocks.createError &&
          args.data.kind === OrchestratorMessageKind.CaseNotify
        ) {
          return Promise.reject(mocks.createError);
        }
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    orchestratorCase: {
      findFirst: (args: unknown) => {
        mocks.caseFind(args);
        return Promise.resolve(mocks.targetCase);
      },
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
    orchestratorAnchor: { create: () => Promise.resolve({}) },
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
  renderCase: () => Promise.resolve("# LD-7"),
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
  mocks.conversationUpdates = [];
  mocks.caseUpdates = [];
  mocks.targetCase = null;
  mocks.conversations = [];
  mocks.noChannel = false;
  mocks.debounceSeconds = 0;
  mocks.createError = null;
  mocks.turnSuperseded.mockResolvedValue(false);
});

async function notify(input: Record<string, unknown>) {
  const result = await orchestratorToolService.call(
    TOKEN,
    OrchestratorToolName.CaseNotify,
    input as never
  );
  if (!result.ok) {
    throw new Error("unauthorized");
  }
  return result.value;
}

function notices() {
  return mocks.messages.filter(
    (m) => m.kind === OrchestratorMessageKind.CaseNotify
  );
}

describe("case_notify", () => {
  it("wakes the other case, reopening it", async () => {
    mocks.targetCase = {
      id: "case-2",
      status: OrchestratorCaseStatus.Closed,
    };
    mocks.conversations = [
      { id: "conversation-9", channelKey: "jira:LD-8:comment:1" },
      { id: "conversation-2", channelKey: "jira:LD-8:item" },
    ];
    const outcome = await notify({
      itemKey: "LD-8",
      message: "LD-7 is in Review",
    });
    expect(outcome).toMatchObject({
      ok: true,
      output: { notified: "LD-8", caseId: "case-2", reopened: true },
    });
    expect(mocks.caseFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflowId: "workflow-1",
          sourceKey: { equals: "jira:LD-8", mode: "insensitive" },
        }),
      })
    );
    expect(notices()).toEqual([
      expect.objectContaining({
        conversationId: "conversation-2",
        origin: OrchestratorMessageOrigin.Internal,
        text: expect.stringContaining("LD-7"),
      }),
    ]);
    expect(notices()[0]).not.toHaveProperty("turnId");
    expect(notices()[0].text).toContain("LD-7 is in Review");
    expect(mocks.caseUpdates).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          status: OrchestratorCaseStatus.Closed,
        }),
        data: expect.objectContaining({ status: OrchestratorCaseStatus.Open }),
      }),
    ]);
    expect(waitUntil).toHaveBeenCalled();
    expect(advanceConversation).toHaveBeenCalledWith("conversation-2");
    expect(mocks.conversationUpdates[0]).toMatchObject({
      where: { id: "conversation-2", organizationId: "org-1" },
    });
  });

  it("matches the item key case-insensitively and uses the case's own key", async () => {
    mocks.targetCase = {
      id: "case-2",
      status: OrchestratorCaseStatus.Open,
      sourceKey: "jira:LD-8",
    };
    mocks.conversations = [
      { id: "conversation-9", channelKey: "jira:LD-8:comment:1" },
      { id: "conversation-2", channelKey: "jira:LD-8:item" },
    ];
    const outcome = await notify({ itemKey: "ld-8", message: "hi" });
    expect(outcome.ok).toBe(true);
    expect(notices()[0]).toMatchObject({ conversationId: "conversation-2" });
  });

  it("falls back to the newest conversation", async () => {
    mocks.targetCase = { id: "case-2", status: OrchestratorCaseStatus.Open };
    mocks.conversations = [
      { id: "conversation-5", channelKey: "jira:LD-8:comment:5" },
      { id: "conversation-4", channelKey: "jira:LD-8:comment:4" },
    ];
    await notify({ itemKey: "LD-8", message: "hi" });
    expect(notices()[0]).toMatchObject({ conversationId: "conversation-5" });
  });

  it("refuses when the conversation has no source item", async () => {
    mocks.noChannel = true;
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome.ok).toBe(false);
    expect(mocks.caseFind).not.toHaveBeenCalled();
    expect(notices()).toHaveLength(0);
  });

  it("refuses when the target case has no conversation", async () => {
    mocks.targetCase = { id: "case-2", status: OrchestratorCaseStatus.Open };
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome)).toContain("no conversation");
    expect(notices()).toHaveLength(0);
  });

  it("refuses when the target is the calling case", async () => {
    mocks.targetCase = { id: "case-1", status: OrchestratorCaseStatus.Open };
    mocks.conversations = [{ id: "conversation-1", channelKey: "x" }];
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome.ok).toBe(false);
    expect(notices()).toHaveLength(0);
  });

  it("does not wake immediately when the workflow debounces", async () => {
    mocks.debounceSeconds = 30;
    mocks.targetCase = { id: "case-2", status: OrchestratorCaseStatus.Open };
    mocks.conversations = [
      { id: "conversation-2", channelKey: "jira:LD-8:item" },
    ];
    const before = Date.now();
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome.ok).toBe(true);
    expect(waitUntil).not.toHaveBeenCalled();
    const wake = (mocks.conversationUpdates[0].data as { nextWakeAt: Date })
      .nextWakeAt;
    expect(wake.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it("uses the same de-dup key for an identical call in one turn", async () => {
    mocks.targetCase = { id: "case-2", status: OrchestratorCaseStatus.Open };
    mocks.conversations = [
      { id: "conversation-2", channelKey: "jira:LD-8:item" },
    ];
    await notify({ itemKey: "LD-8", message: "same" });
    await notify({ itemKey: "LD-8", message: "same" });
    await notify({ itemKey: "LD-8", message: "other" });
    const keys = notices().map((m) => m.dedupKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("treats a duplicate notice as already sent", async () => {
    mocks.targetCase = { id: "case-2", status: OrchestratorCaseStatus.Open };
    mocks.conversations = [
      { id: "conversation-2", channelKey: "jira:LD-8:item" },
    ];
    mocks.createError = { code: "P2002" };
    const outcome = await notify({ itemKey: "LD-8", message: "same" });
    expect(outcome.ok).toBe(true);
    expect(notices()).toHaveLength(0);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("refuses an item without a case", async () => {
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome).toMatchObject({ ok: false });
    expect(JSON.stringify(outcome)).toContain("LD-8");
    expect(notices()).toHaveLength(0);
    expect(
      mocks.messages.some((m) => m.kind === OrchestratorMessageKind.ToolRefused)
    ).toBe(true);
  });

  it("refuses the case's own item", async () => {
    const outcome = await notify({ itemKey: "ld-7", message: "hi" });
    expect(outcome.ok).toBe(false);
    expect(mocks.caseFind).not.toHaveBeenCalled();
    expect(
      mocks.messages.some((m) => m.kind === OrchestratorMessageKind.ToolRefused)
    ).toBe(true);
  });

  it("refuses when the turn is superseded", async () => {
    mocks.turnSuperseded.mockResolvedValue(true);
    const outcome = await notify({ itemKey: "LD-8", message: "hi" });
    expect(outcome).toMatchObject({ ok: false, error: TURN_SUPERSEDED_ERROR });
    expect(notices()).toHaveLength(0);
  });

  it("refuses invalid input", async () => {
    const outcome = await notify({ itemKey: "" });
    expect(outcome.ok).toBe(false);
    expect(notices()).toHaveLength(0);
  });
});
