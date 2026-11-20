import { OrchestratorToolName } from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConnectionRuntime } from "@/__tests__/support/orchestrator-tools/connection-runtime.test-fixtures";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";

/**
 * The runners_list tool (docs/orchestrator.md): it returns each runner's
 * AGENTFLOW.md and records what the conversation read, which the task_run
 * guard checks.
 */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  turn: null as Row | null,
  turnUpdates: [] as Row[],
  caseUpdates: [] as Row[],
  conversationUpdates: [] as Row[],
  runnerFiles: [] as Row[],
  messages: [] as Row[],
  anchors: [] as Row[],
  replyOnItem: vi.fn(),
  startTask: vi.fn(),
  cancelTask: vi.fn(),
  createWait: vi.fn(),
  evaluateWaits: vi.fn(),
  taskCount: 0,
  editOnItem: vi.fn(),
  anchor: null as Row | null,
  anchorUpdates: [] as Row[],
  requestDecision: vi.fn(),
  decide: vi.fn(),
  messageQueries: [] as Row[],
  latestMessage: { externalRef: "500", payload: null } as Row | null,
  attachFile: vi.fn(),
  findCaseTaskFiles: vi.fn(),
  getLoopAttachment: vi.fn(),
  hasAttachFile: true,
  taskRow: null as Row | null,
  turnSuperseded: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTurn: {
      findFirst: (args: { where: { tokenHash: string } }) =>
        Promise.resolve(
          mocks.turn && args.where.tokenHash === mocks.turn.tokenHash
            ? mocks.turn
            : null
        ),
      updateMany: (args: { data: Row }) => {
        mocks.turnUpdates.push(args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    orchestratorConversation: {
      updateMany: (args: { data: Row }) => {
        mocks.conversationUpdates.push(args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    orchestratorCase: {
      update: (args: { data: Row }) => {
        mocks.caseUpdates.push(args.data);
        return Promise.resolve({});
      },
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
      findFirst: (args: { where: Row }) => {
        mocks.messageQueries.push(args.where);
        return Promise.resolve(mocks.latestMessage);
      },
      findMany: (args: { where: Row }) => {
        mocks.messageQueries.push(args.where);
        return Promise.resolve(
          mocks.latestMessage ? [mocks.latestMessage] : []
        );
      },
    },
    orchestratorTask: {
      count: () => Promise.resolve(mocks.taskCount),
      findFirst: () => Promise.resolve(mocks.taskRow),
    },
    organization: {
      findUnique: () => Promise.resolve({ slug: "agentflow" }),
    },
    orchestratorAnchor: {
      findFirst: () => Promise.resolve(mocks.anchor),
      update: (args: { data: Row }) => {
        mocks.anchorUpdates.push(args.data);
        return Promise.resolve({});
      },
      create: (args: { data: Row }) => {
        mocks.anchors.push(args.data);
        return Promise.resolve(args.data);
      },
    },
  };
  const run = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb: Object.assign(run, { tx: run }) };
});
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () =>
    Promise.resolve(buildConnectionRuntime(mocks)),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/lib/orchestrator/task-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/task-files")>()),
  findCaseTaskFiles: mocks.findCaseTaskFiles,
}));
vi.mock("@/lib/loops/loop-state", () => ({
  getLoopAttachment: mocks.getLoopAttachment,
}));
vi.mock("@/lib/orchestrator/case-render", () => ({
  renderCase: () => Promise.resolve("# LD-7"),
}));
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { FULL_GRANTS, workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return { loadOrchestratorWorkflows: () => workflowsWith(FULL_GRANTS) };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: mocks.turnSuperseded,
}));
vi.mock("@/lib/orchestrator/tasks", () => ({ startTask: mocks.startTask }));
vi.mock("@/lib/orchestrator/task-cancel", () => ({
  cancelTask: mocks.cancelTask,
}));
vi.mock("@/lib/orchestrator/decisions", () => ({
  requestDecision: mocks.requestDecision,
  decide: mocks.decide,
}));
vi.mock("@/lib/orchestrator/waits", () => ({
  createWait: mocks.createWait,
  evaluateWaits: mocks.evaluateWaits,
}));
vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: {
    listForProject: () => Promise.resolve(mocks.runnerFiles),
  },
}));

const ITEM = {
  provider: "jira",
  externalId: "10001",
  key: "LD-7",
  url: null,
  title: "Half-day leave",
  container: "LD",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.turnUpdates = [];
  mocks.caseUpdates = [];
  mocks.conversationUpdates = [];
  mocks.runnerFiles = [];
  mocks.messages = [];
  mocks.anchors = [];
  mocks.turn = {
    id: "turn-1",
    organizationId: "org-1",
    tokenHash: hashOrchestratorToken(TOKEN),
    conversation: {
      id: "conversation-1",
      projectId: "project-1",
      caseId: "case-1",
      projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
      channel: { item: ITEM, parentId: null, extras: null },
      case: { workflowId: "workflow-1" },
    },
  };
  mocks.replyOnItem.mockResolvedValue({ ok: true, externalRef: "900" });
  mocks.taskCount = 0;
  mocks.hasAttachFile = true;
  mocks.taskRow = null;
  mocks.turnSuperseded.mockResolvedValue(false);
  mocks.getLoopAttachment.mockResolvedValue(new Uint8Array([1]));
  mocks.anchor = null;
  mocks.anchorUpdates = [];
  mocks.messageQueries = [];
  mocks.latestMessage = { externalRef: "500", payload: null };
});

describe("orchestratorToolService runners_list", () => {
  it("records the contentHash of each runner file it returned", async () => {
    const file = (id: string, contentHash: string) => ({
      computeTargetId: id,
      runnerName: `runner-${id}`,
      isOnline: true,
      capabilities: null,
      problems: [],
      content: "x",
      contentHash,
    });
    mocks.runnerFiles = [file("t1", "h1"), file("t2", "h2")];
    const result = await orchestratorToolService.call(
      TOKEN,
      OrchestratorToolName.RunnersList,
      {}
    );
    expect(result.ok).toBe(true);
    expect(mocks.conversationUpdates).toContainEqual({
      runnersRead: { turnId: "turn-1", hashes: { t1: "h1", t2: "h2" } },
    });
  });
});
