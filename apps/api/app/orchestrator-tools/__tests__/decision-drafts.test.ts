import { SourceOperation } from "@repo/api/src/types/connection-grants";
import { OrchestratorDraftOutcome } from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  carryOutDecisionDraft,
  decisionDraftInputSchema,
  prepareDecisionDraft,
} from "@/app/orchestrator-tools/service/decision-drafts";
import type { TurnContext } from "@/app/orchestrator-tools/service/turn";
import type { StoredDecisionDraft } from "@/lib/orchestrator/decision-draft";

/** A decision's draft: checked when asked, carried out once when approved. */

const TURN_ID = "0199a5f0-0000-7000-8000-0000000000a1";
const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const ITEM = {
  provider: "jira",
  externalId: "10001",
  key: "LD-7",
  url: null,
  title: "Half-day leave",
  container: "LD",
};

const mocks = vi.hoisted(() => ({
  connections: {} as Record<string, string[] | "read">,
  replyOnItem: vi.fn(),
  attachFile: undefined as unknown,
  replyThread: vi.fn(),
  findFiles: vi.fn(),
  execute: vi.fn(),
  hasDefinition: true,
  calls: [] as string[],
  recordFails: false,
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorConversation: {
      findFirst: () =>
        Promise.resolve({
          id: "conversation-1",
          projectId: "project-1",
          caseId: "case-1",
          projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
          case: { workflowId: "workflow-1" },
          channel: { item: ITEM, parentId: null, extras: null },
        }),
    },
    orchestratorMessage: {
      create: () =>
        mocks.recordFails
          ? Promise.reject(new Error("db down"))
          : Promise.resolve({}),
    },
    orchestratorAnchor: { create: () => Promise.resolve({}) },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/lib/orchestrator/workflow-settings", () => ({
  loadOrchestratorWorkflows: () =>
    Promise.resolve(
      new Map([
        ["workflow-1", { name: "LeaveDesk", connections: mocks.connections }],
      ])
    ),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () =>
    Promise.resolve({
      connection: {
        record: { id: "connection-1" },
        provider: {
          replyOnItem: mocks.replyOnItem,
          source: { attachFile: mocks.attachFile },
        },
        runtime: { secrets: {} },
      },
    }),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/lib/integrations/connection-grants", () => ({
  sourceGrantDefinitions: () =>
    mocks.hasDefinition
      ? [
          {
            configSchema: {
              safeParse: (data: unknown) => ({ success: true, data }),
            },
            execute: mocks.execute,
          },
        ]
      : [],
}));
vi.mock("@/lib/integrations/registry", () => ({
  getIntegrationProvider: () => ({ displayName: "Jira" }),
}));
vi.mock("@/app/orchestrator-tools/service/threads", () => ({
  replyThread: mocks.replyThread,
  latestMessageRef: () => Promise.resolve(undefined),
  replyTargetOf: () => Promise.resolve(undefined),
}));
vi.mock("@/lib/orchestrator/task-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/task-files")>()),
  findCaseTaskFiles: mocks.findFiles,
}));
vi.mock("@/lib/orchestrator/ticket-change", () => ({
  ticketChangeMessage: () => ({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connections = {};
  mocks.attachFile = undefined;
  mocks.hasDefinition = true;
  mocks.calls = [];
  mocks.recordFails = false;
  mocks.replyThread.mockResolvedValue(undefined);
  mocks.findFiles.mockResolvedValue({ ok: true, value: [] });
  mocks.replyOnItem.mockImplementation(() => {
    mocks.calls.push("comment");
    return Promise.resolve({ ok: true, externalRef: "900" });
  });
  mocks.execute.mockImplementation(() => {
    mocks.calls.push("transition");
    return Promise.resolve({ status: "success" });
  });
});

function grant(...source: string[]) {
  mocks.connections = { source };
}

function context(): TurnContext {
  return {
    turnId: TURN_ID,
    organizationId: "org-1",
    conversationId: "conversation-1",
    projectId: "project-1",
    caseId: "case-1",
    projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
    channel: { item: ITEM, parentId: null, extras: null },
    grants: {
      source: new Set(mocks.connections.source ?? []),
    } as unknown as TurnContext["grants"],
    workflowId: "workflow-1",
    workflowName: "LeaveDesk",
    features: {
      caseLookup: false,
      caseHandoff: false,
      approvalsRequired: true,
    },
  };
}

function parse(input: unknown) {
  return decisionDraftInputSchema.parse(input);
}

function stored(
  overrides: Partial<StoredDecisionDraft> = {}
): StoredDecisionDraft {
  return {
    turnId: TURN_ID,
    itemKey: "LD-7",
    comment: { text: "Approved.", replyTo: null, attachments: [] },
    transitionName: null,
    ...overrides,
  };
}

const decision = (draft: StoredDecisionDraft) => ({
  id: "decision-1",
  conversationId: "conversation-1",
  caseId: "case-1",
  draft,
});

describe("prepareDecisionDraft", () => {
  it("rejects an empty draft", () => {
    expect(decisionDraftInputSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a comment without the comment grant", async () => {
    const result = await prepareDecisionDraft(
      context(),
      parse({ comment: { text: "Hi" } })
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("source: comment is not granted"),
    });
  });

  it("refuses a replyTo of another conversation", async () => {
    grant(OrchestratorSourceOperation.Comment);
    mocks.replyThread.mockResolvedValue(null);
    const result = await prepareDecisionDraft(
      context(),
      parse({ comment: { text: "Hi", replyTo: "999" } })
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("replyTo: 999"),
    });
  });

  it("refuses a missing attachment", async () => {
    grant(
      OrchestratorSourceOperation.Comment,
      OrchestratorSourceOperation.Attach
    );
    mocks.attachFile = vi.fn();
    mocks.findFiles.mockResolvedValue({ ok: false, error: "no such file" });
    const result = await prepareDecisionDraft(
      context(),
      parse({
        comment: {
          text: "Hi",
          attachments: [{ taskId: TASK_ID, name: "a.pdf" }],
        },
      })
    );
    expect(result).toEqual({ ok: false, error: "no such file" });
  });

  it("refuses a transition without the grant", async () => {
    const result = await prepareDecisionDraft(
      context(),
      parse({ transitionName: "Done" })
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("source: transition is not granted"),
    });
  });

  it("returns the stored shape with turnId and itemKey", async () => {
    grant(
      OrchestratorSourceOperation.Comment,
      OrchestratorSourceOperation.Transition
    );
    const result = await prepareDecisionDraft(
      context(),
      parse({ comment: { text: "Approved." }, transitionName: "Done" })
    );
    expect(result).toEqual({
      ok: true,
      value: {
        turnId: TURN_ID,
        itemKey: "LD-7",
        comment: { text: "Approved.", replyTo: null, attachments: [] },
        transitionName: "Done",
      },
    });
  });
});

describe("carryOutDecisionDraft", () => {
  it("posts the comment once and returns Done with its reference", async () => {
    grant(OrchestratorSourceOperation.Comment);
    const result = await carryOutDecisionDraft("org-1", decision(stored()));
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Done,
      commentRef: "900",
      transition: null,
      error: null,
    });
  });

  it("never reports a failed post when only recording the reply failed", async () => {
    grant(OrchestratorSourceOperation.Comment);
    mocks.recordFails = true;
    const result = await carryOutDecisionDraft("org-1", decision(stored()));
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Done,
      commentRef: "900",
    });
  });

  it("posts the comment, then moves the item", async () => {
    grant(OrchestratorSourceOperation.Comment, SourceOperation.Transition);
    const result = await carryOutDecisionDraft(
      "org-1",
      decision(stored({ transitionName: "Done" }))
    );
    expect(mocks.calls).toEqual(["comment", "transition"]);
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Done,
      commentRef: "900",
      transition: { to: "Done" },
    });
  });

  it("fails and skips the move when the post fails", async () => {
    grant(OrchestratorSourceOperation.Comment, SourceOperation.Transition);
    mocks.replyOnItem.mockResolvedValue({
      ok: false,
      error: "boom",
      retryable: false,
    });
    const result = await carryOutDecisionDraft(
      "org-1",
      decision(stored({ transitionName: "Done" }))
    );
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Failed,
      commentRef: null,
      error: expect.stringContaining("boom"),
    });
  });

  it("keeps the comment reference when the move throws after the post", async () => {
    grant(OrchestratorSourceOperation.Comment, SourceOperation.Transition);
    mocks.execute.mockRejectedValue(new Error("Jira down"));
    const result = await carryOutDecisionDraft(
      "org-1",
      decision(stored({ transitionName: "Done" }))
    );
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Failed,
      commentRef: "900",
      error: expect.stringContaining("Jira down"),
    });
  });

  it("fails with not granted when the grant was removed", async () => {
    const result = await carryOutDecisionDraft("org-1", decision(stored()));
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: OrchestratorDraftOutcome.Failed,
      error: expect.stringContaining("not granted"),
    });
  });
});
