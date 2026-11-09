import {
  type OrchestratorDecisionDraftResult,
  OrchestratorDecisionStatus,
  OrchestratorDecisionVia,
  OrchestratorDraftOutcome,
  OrchestratorMessageKind,
} from "@repo/api/src/types/orchestrator";
import { Status } from "@repo/api/src/types/result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide, requestDecision } from "@/lib/orchestrator/decisions";

/**
 * Decisions (docs/orchestrator.md): taken once, by a button or a message;
 * a button's decision wakes the conversation that asked.
 */

type Row = Record<string, unknown>;

const NOW = new Date("2026-10-23T10:00:00.000Z");

const mocks = vi.hoisted(() => ({
  decisions: [] as Row[],
  messages: [] as Row[],
  wakes: [] as Row[],
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorDecision: {
      create: (args: { data: Row }) => {
        const row = {
          id: `decision-${mocks.decisions.length + 1}`,
          status: OrchestratorDecisionStatus.Pending,
          ...args.data,
        };
        mocks.decisions.push(row);
        return Promise.resolve(row);
      },
      findFirst: (args: { where: Row }) =>
        Promise.resolve(
          mocks.decisions.find(
            (row) =>
              row.id === args.where.id &&
              row.status === args.where.status &&
              (args.where.caseId === undefined ||
                row.caseId === args.where.caseId)
          ) ?? null
        ),
      updateMany: (args: { where: Row; data: Row }) => {
        const row = mocks.decisions.find(
          (decision) =>
            decision.id === args.where.id &&
            decision.status === args.where.status
        );
        if (!row) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    orchestratorConversation: {
      update: (args: { where: { id: string }; data: Row }) => {
        mocks.wakes.push({ id: args.where.id, ...args.data });
        return Promise.resolve({});
      },
    },
  };
  const withDb = (fn: (client: unknown) => unknown) => fn(db);
  withDb.tx = (fn: (client: unknown) => unknown) => fn(db);
  return { withDb };
});

beforeEach(() => {
  mocks.decisions = [];
  mocks.messages = [];
  mocks.wakes = [];
});

async function ask(draft: typeof DRAFT | null = null) {
  return await requestDecision({
    organizationId: "org-1",
    caseId: "case-1",
    conversationId: "conversation-1",
    question: "Approve plan v2 of LD-7?",
    draft,
  });
}

const TURN_ID = "11111111-1111-4111-8111-111111111111";

const DRAFT = {
  itemKey: "LD-9",
  comment: { text: "Plan v2 attached.", replyTo: null, attachments: [] },
  transitionName: "Planning",
  turnId: TURN_ID,
};

const DONE: OrchestratorDecisionDraftResult = {
  outcome: OrchestratorDraftOutcome.Done,
  commentRef: "123",
  transition: { from: "Backlog", to: "Planning" },
  error: null,
  carriedOutAt: NOW.toISOString(),
};

function approval(decisionId: string, extra: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    decisionId,
    approved: true,
    comment: null,
    via: OrchestratorDecisionVia.Button,
    decidedBy: "Ada Admin",
    decidedById: "user-1",
    ...extra,
  };
}

describe("decide", () => {
  it("takes an admin's decision once and wakes the conversation that asked", async () => {
    const decisionId = await ask();
    const input = {
      organizationId: "org-1",
      decisionId,
      approved: true,
      comment: "Go.",
      via: OrchestratorDecisionVia.Button,
      decidedBy: "Ada Admin",
      decidedById: "user-1",
    };

    const first = await decide(input, NOW);
    const second = await decide({ ...input, approved: false }, NOW);

    expect(first).toEqual({
      ok: true,
      value: {
        conversationId: "conversation-1",
        draftResult: null,
        draftNote: null,
      },
    });
    expect(second).toEqual({ ok: false, error: Status.NotFound });
    expect(mocks.decisions[0]).toMatchObject({
      status: OrchestratorDecisionStatus.Approved,
      via: OrchestratorDecisionVia.Button,
      decidedBy: "Ada Admin",
      decidedById: "user-1",
      comment: "Go.",
      decidedAt: NOW,
    });
    expect(mocks.messages).toMatchObject([
      {
        kind: OrchestratorMessageKind.Decision,
        dedupKey: `decision:${decisionId}`,
        text: expect.stringContaining("approved by Ada Admin (button): Go."),
      },
    ]);
    expect(mocks.wakes).toEqual([{ id: "conversation-1", nextWakeAt: NOW }]);
  });

  it("records a decision the orchestrator was told without waking it again", async () => {
    const decisionId = await ask();

    await decide(
      {
        organizationId: "org-1",
        decisionId,
        approved: false,
        comment: "Not before the API is ready",
        via: OrchestratorDecisionVia.Message,
        decidedBy: "An",
        decidedById: null,
        caseId: "case-1",
        notify: false,
      },
      NOW
    );

    expect(mocks.decisions[0]?.status).toBe(
      OrchestratorDecisionStatus.Rejected
    );
    expect(mocks.messages).toEqual([]);
  });

  it("keeps the orchestrator to its own case's decisions", async () => {
    const decisionId = await ask();

    const result = await decide({
      organizationId: "org-1",
      decisionId,
      approved: true,
      comment: null,
      via: OrchestratorDecisionVia.Message,
      decidedBy: "An",
      decidedById: null,
      caseId: "case-2",
    });

    expect(result).toEqual({ ok: false, error: Status.NotFound });
  });

  it("approval with a draft carries it out once", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockResolvedValue(DONE);

    const results = await Promise.all([
      decide(approval(decisionId, { carryOut }), NOW),
      decide(approval(decisionId, { carryOut }), NOW),
    ]);

    expect(carryOut).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: Status.NotFound },
    ]);
    expect(mocks.decisions[0]?.draftResult).toEqual(DONE);
  });

  it("button and record_decision race: carry-out runs once", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockResolvedValue(DONE);

    await Promise.all([
      decide(approval(decisionId, { carryOut, notify: false }), NOW),
      decide(approval(decisionId, { carryOut, notify: true }), NOW),
    ]);

    expect(carryOut).toHaveBeenCalledTimes(1);
  });

  it("the wake message carries the result note and comes after carry-out", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockImplementation(() => {
      expect(mocks.messages).toEqual([]);
      expect(mocks.wakes).toEqual([]);
      return Promise.resolve(DONE);
    });

    const result = await decide(approval(decisionId, { carryOut }), NOW);

    expect(mocks.messages).toMatchObject([
      { text: expect.stringContaining("Do not post or move it again") },
    ]);
    expect(mocks.wakes).toEqual([{ id: "conversation-1", nextWakeAt: NOW }]);
    expect(result).toMatchObject({
      ok: true,
      value: { draftNote: expect.stringContaining("LD-9") },
    });
  });

  it("a throwing carryOut is recorded as failed", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockRejectedValue(new Error("Jira is down"));

    await decide(approval(decisionId, { carryOut }), NOW);

    expect(mocks.decisions[0]?.draftResult).toMatchObject({
      outcome: OrchestratorDraftOutcome.Failed,
      error: "Jira is down",
    });
    expect(mocks.messages).toHaveLength(1);
  });

  it("refuseDraftApproval keeps a draft decision pending and posts nothing", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockResolvedValue(DONE);

    const result = await decide(
      approval(decisionId, { carryOut, refuseDraftApproval: true }),
      NOW
    );

    expect(result).toEqual({ ok: false, error: Status.Forbidden });
    expect(carryOut).not.toHaveBeenCalled();
    expect(mocks.decisions[0]?.status).toBe(OrchestratorDecisionStatus.Pending);
  });

  it("rejection never carries out", async () => {
    const decisionId = await ask(DRAFT);
    const carryOut = vi.fn().mockResolvedValue(DONE);

    await decide(approval(decisionId, { carryOut, approved: false }), NOW);

    expect(carryOut).not.toHaveBeenCalled();
    expect(mocks.decisions[0]?.draftResult).toBeUndefined();
  });
});

describe("requestDecision", () => {
  it("stores the draft", async () => {
    await ask(DRAFT);

    expect(mocks.decisions[0]?.draft).toEqual(DRAFT);
  });

  it("leaves the draft out when there is none", async () => {
    await ask();

    expect(mocks.decisions[0]).not.toHaveProperty("draft");
  });
});
