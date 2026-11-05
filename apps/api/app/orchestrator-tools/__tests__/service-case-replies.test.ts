import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorReplyTarget,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";

/** Replies to a message written on the case page stay on the case page. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";
const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const FROM_CASE_PAGE = {
  externalRef: "agentflow-1",
  payload: { via: "agentflow", parentId: null },
};
const FROM_JIRA = { externalRef: "700", payload: { parentId: null } };

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  connections: {} as Record<string, string[] | "read">,
  external: [] as Row[],
  replyOnItem: vi.fn(),
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
            channel: {
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
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
      findMany: (args: { take: number }) =>
        Promise.resolve(mocks.external.slice(0, args.take)),
      findFirst: (args: { where: { externalRef?: string } }) =>
        Promise.resolve(
          mocks.external.find(
            (m) => m.externalRef === args.where.externalRef
          ) ?? null
        ),
    },
    orchestratorAnchor: { create: () => Promise.resolve({}) },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return { loadOrchestratorWorkflows: () => workflowsWith(mocks.connections) };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: () => Promise.resolve(false),
}));
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
  loadProjectConnectionRuntime: () =>
    Promise.resolve({
      connection: {
        provider: { replyOnItem: mocks.replyOnItem },
        runtime: { secrets: {} },
      },
    }),
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
  mocks.connections = {};
  mocks.external = [FROM_CASE_PAGE];
  mocks.replyOnItem.mockResolvedValue({ ok: true, externalRef: "900" });
});

async function call(tool: string, input: Record<string, unknown>) {
  const result = await orchestratorToolService.call(
    TOKEN,
    tool,
    input as never
  );
  if (!result.ok) {
    throw new Error("unauthorized");
  }
  return result.value;
}

describe("replies to case page messages", () => {
  it("answers on the case page with no grant and no provider call", async () => {
    const outcome = await call(OrchestratorToolName.Reply, { text: "Done" });
    expect(outcome).toMatchObject({
      ok: true,
      output: { posted: true, where: OrchestratorReplyTarget.CasePage },
    });
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
    expect(mocks.messages).toEqual([
      expect.objectContaining({
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.Reply,
        turnId: "turn-1",
        payload: expect.objectContaining({
          via: OrchestratorMessageVia.AgentFlow,
        }),
      }),
    ]);
  });

  it("posts on the ticket with where thread, which needs comment", async () => {
    const refusedOutcome = await call(OrchestratorToolName.Reply, {
      text: "Done",
      where: OrchestratorReplyTarget.Thread,
    });
    expect(refusedOutcome.ok).toBe(false);
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    const outcome = await call(OrchestratorToolName.Reply, {
      text: "Done",
      where: OrchestratorReplyTarget.Thread,
    });
    expect(outcome.ok).toBe(true);
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
  });

  it("answers a Jira comment in its thread while the latest message is from AgentFlow", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    mocks.external = [FROM_CASE_PAGE, FROM_JIRA];
    await call(OrchestratorToolName.Reply, { text: "Done", replyTo: "700" });
    expect(mocks.replyOnItem).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ parentId: "700" })
    );
  });

  it("takes no files on the case page", async () => {
    const outcome = await call(OrchestratorToolName.Reply, {
      text: "Done",
      attachments: [{ taskId: TASK_ID, name: "a.md" }],
    });
    expect(outcome.ok).toBe(false);
    expect(
      mocks.messages.every((m) => m.kind !== OrchestratorMessageKind.Reply)
    ).toBe(true);
  });
});

describe("request_decision and the grant", () => {
  const question = { question: "Publish the PRD?" };

  it("posts on the case page without any grant", async () => {
    const outcome = await call(OrchestratorToolName.RequestDecision, question);
    expect(outcome).toMatchObject({ ok: true, output: { posted: true } });
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("is refused for the ticket thread without source: comment", async () => {
    mocks.external = [FROM_JIRA];
    const outcome = await call(OrchestratorToolName.RequestDecision, question);
    expect(outcome.ok).toBe(false);
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("posts on the ticket thread with source: comment", async () => {
    mocks.external = [FROM_JIRA];
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    const outcome = await call(OrchestratorToolName.RequestDecision, question);
    expect(outcome).toMatchObject({ ok: true, output: { posted: true } });
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
  });
});
