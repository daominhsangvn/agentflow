import {
  OrchestratorApprovals,
  OrchestratorReplyTarget,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { Result, Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";

/** request_decision drafts, record_decision carry-out and approvals: required. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";
const FROM_CASE_PAGE = {
  externalRef: "agentflow-1",
  payload: { via: "agentflow", parentId: null },
};

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  connections: {} as Record<string, string[] | "read">,
  approvals: "optional" as string,
  requestDecision: vi.fn(),
  decide: vi.fn(),
  prepare: vi.fn(),
  carryOut: vi.fn(),
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
  return {
    loadOrchestratorWorkflows: async () => {
      const map = await workflowsWith(mocks.connections);
      const entry = map.get("workflow-1");
      return new Map([
        ["workflow-1", { ...entry, approvals: mocks.approvals }],
      ]);
    },
  };
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
  requestDecision: mocks.requestDecision,
  decide: mocks.decide,
}));
vi.mock("@/app/orchestrator-tools/service/decision-drafts", async (orig) => ({
  ...(await orig<
    typeof import("@/app/orchestrator-tools/service/decision-drafts")
  >()),
  prepareDecisionDraft: mocks.prepare,
  carryOutDecisionDraft: mocks.carryOut,
}));
vi.mock("@/lib/orchestrator/waits", () => ({
  createWait: vi.fn(),
  evaluateWaits: vi.fn(),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () =>
    Promise.resolve({
      connection: {
        record: { id: "connection-1" },
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

const STORED = {
  turnId: "0199a5f0-0000-7000-8000-0000000000a1",
  itemKey: "LD-7",
  comment: { text: "Full comment", replyTo: null, attachments: [] },
  transitionName: "Planning",
};
const DECISION_ID = "0199a5f0-0000-7000-8000-0000000000d1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.connections = {};
  mocks.approvals = OrchestratorApprovals.Optional;
  mocks.external = [FROM_CASE_PAGE];
  mocks.replyOnItem.mockResolvedValue({ ok: true, externalRef: "900" });
  mocks.requestDecision.mockResolvedValue(DECISION_ID);
  mocks.prepare.mockResolvedValue(Result.ok(STORED));
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

const draft = { comment: { text: "Full comment" }, transitionName: "Planning" };

describe("request_decision with a draft", () => {
  it("stores the draft and posts only the question on the case page", async () => {
    const outcome = await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.CasePage,
      draft,
    });
    expect(outcome.ok).toBe(true);
    expect(mocks.requestDecision).toHaveBeenCalledWith(
      expect.objectContaining({ draft: STORED })
    );
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("posts the question and the draft text in one comment on the thread", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.Thread,
      draft,
    });
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(mocks.replyOnItem.mock.calls[0]);
    expect(text).toContain("Post it?");
    expect(text).toContain("Full comment");
  });

  it("renders a move-only draft on the thread without a comment block", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    mocks.prepare.mockResolvedValue(
      Result.ok({ ...STORED, comment: null, transitionName: "Planning" })
    );
    await call(OrchestratorToolName.RequestDecision, {
      question: "Move it?",
      where: OrchestratorReplyTarget.Thread,
      draft: { transitionName: "Planning" },
    });
    const sent = mocks.replyOnItem.mock.calls[0][1].text as string;
    expect(sent).not.toContain("\n\n\n");
    expect(sent).toContain("to Planning");
  });

  it("refuses a thread post that is too long and stores no decision", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    mocks.prepare.mockResolvedValue(
      Result.ok({
        ...STORED,
        comment: { ...STORED.comment, text: "x".repeat(40_000) },
      })
    );
    const outcome = await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.Thread,
      draft,
    });
    expect(outcome.ok).toBe(false);
    expect(mocks.requestDecision).not.toHaveBeenCalled();
  });

  it("refuses a draft the preparation rejects", async () => {
    mocks.prepare.mockResolvedValue(
      Result.err("source: comment is not granted")
    );
    const outcome = await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.CasePage,
      draft,
    });
    expect(outcome.ok).toBe(false);
    expect(mocks.requestDecision).not.toHaveBeenCalled();
  });
});

describe("record_decision", () => {
  const input = { decisionId: DECISION_ID, approved: true, decidedBy: "Ann" };

  it("returns the carried-out note, then refuses a second record", async () => {
    mocks.decide
      .mockResolvedValueOnce(
        Result.ok({
          conversationId: "conversation-1",
          draftResult: null,
          draftNote: "AgentFlow carried out the approved draft.",
        })
      )
      .mockResolvedValueOnce(Result.err("not_found"));
    const first = await call(OrchestratorToolName.RecordDecision, input);
    expect(first).toMatchObject({
      ok: true,
      output: {
        recorded: true,
        draft: "AgentFlow carried out the approved draft.",
      },
    });
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        carryOut: expect.any(Function),
        refuseDraftApproval: false,
      })
    );
    const second = await call(OrchestratorToolName.RecordDecision, input);
    expect(second.ok).toBe(false);
  });
});

describe("approvals: required", () => {
  beforeEach(() => {
    mocks.approvals = OrchestratorApprovals.Required;
    mocks.connections = {
      source: [
        OrchestratorSourceOperation.Comment,
        OrchestratorSourceOperation.Transition,
        OrchestratorSourceOperation.Label,
        OrchestratorSourceOperation.Link,
      ],
    };
  });

  it("refuses thread writes", async () => {
    const calls: [string, Record<string, unknown>][] = [
      [
        OrchestratorToolName.Reply,
        { text: "Hi", where: OrchestratorReplyTarget.Thread },
      ],
      [OrchestratorToolName.EditReply, { reference: "900", text: "Hi" }],
      [OrchestratorToolName.SourceItemTransition, { transitionName: "Done" }],
      [OrchestratorToolName.SourceItemLabel, { add: ["a"] }],
      [
        OrchestratorToolName.SourceItemLink,
        { url: "https://example.com", title: "t" },
      ],
    ];
    for (const [tool, args] of calls) {
      const outcome = await call(tool, args);
      expect(outcome.ok).toBe(false);
    }
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("allows case page replies and request_decision on the case page", async () => {
    const replied = await call(OrchestratorToolName.Reply, {
      text: "Hi",
      where: OrchestratorReplyTarget.CasePage,
    });
    expect(replied.ok).toBe(true);
    const asked = await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.CasePage,
      draft,
    });
    expect(asked.ok).toBe(true);
  });

  it("refuses request_decision on the thread and stores nothing", async () => {
    const asked = await call(OrchestratorToolName.RequestDecision, {
      question: "Post it?",
      where: OrchestratorReplyTarget.Thread,
      draft,
    });
    expect(asked.ok).toBe(false);
    expect(mocks.requestDecision).not.toHaveBeenCalled();
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("record_decision asks decide to refuse approving a draft, and says so", async () => {
    mocks.decide.mockResolvedValue(Result.err(Status.Forbidden));
    const outcome = await call(OrchestratorToolName.RecordDecision, {
      decisionId: DECISION_ID,
      approved: true,
      decidedBy: "Ann",
    });
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({ refuseDraftApproval: true })
    );
    expect(outcome).toMatchObject({
      ok: false,
      error: expect.stringContaining("only an admin's Approve button"),
    });
  });

  it("record_decision with approved: false still records", async () => {
    mocks.decide.mockResolvedValue(
      Result.ok({
        conversationId: "conversation-1",
        draftResult: null,
        draftNote: null,
      })
    );
    const outcome = await call(OrchestratorToolName.RecordDecision, {
      decisionId: DECISION_ID,
      approved: false,
      decidedBy: "Ann",
    });
    expect(outcome.ok).toBe(true);
  });
});
