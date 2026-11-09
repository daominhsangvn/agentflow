import {
  OrchestratorMessageKind,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderCase } from "@/lib/orchestrator/case-render";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  listCaseDocuments: vi.fn(),
}));

vi.mock("@/lib/orchestrator/case-documents", () => ({
  listCaseDocuments: mocks.listCaseDocuments,
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ orchestratorCase: { findUnique: mocks.findUnique } }),
}));

/** CASE.md task lines say what started each task (docs/orchestrator.md). */

type Message = { kind: string; text: string };

function task(
  id: string,
  messages: Message[] | null,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    command: "plan",
    args: null,
    mode: "STEP",
    status: OrchestratorTaskStatus.Running,
    result: null,
    computeTarget: { machineName: "runner-1" },
    conversation: { channelKey: "jira:LD-7" },
    turn: messages ? { messages } : null,
    ...extra,
  };
}

function mockCase(tasks: unknown[]) {
  mocks.findUnique.mockResolvedValue({
    organizationId: "org-1",
    title: "LD-7",
    status: "open",
    sourceKey: null,
    notes: "",
    conversations: [],
    tasks,
    decisions: [],
  });
}

describe("renderCase task lines", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset();
    mocks.listCaseDocuments.mockReset();
    mocks.listCaseDocuments.mockResolvedValue([]);
  });

  it("lists the published documents, or says there are none", async () => {
    mockCase([]);
    expect(await renderCase("c1")).toContain("## Documents\n(none yet)");
    mocks.listCaseDocuments.mockResolvedValue([
      {
        pageId: "123",
        title: "LD-7 · PRD",
        url: "https://x.atlassian.net/wiki/pages/123",
        version: 3,
        kind: "prd",
        space: "ENG",
        attachments: [],
      },
    ]);
    expect(await renderCase("c1")).toContain(
      'PRD "LD-7 · PRD" → https://x.atlassian.net/wiki/pages/123 (v3, page 123)'
    );
  });

  it("names the status change that started a task", async () => {
    const text = "Status changed: To Do → Prepare Requirements (by Shawn)";
    mockCase([task("t1", [{ kind: "status_changed", text }])]);
    expect(await renderCase("c1")).toContain(
      `started for: status_changed "${text}"`
    );
  });

  it("names the label that started a task", async () => {
    mockCase([
      task("t1", [
        { kind: "label_added", text: "Label added: create-prd (by Shawn)" },
      ]),
    ]);
    expect(await renderCase("c1")).toContain(
      'started for: label_added "Label added: create-prd (by Shawn)"'
    );
  });

  it("shows the channel and text for a comment turn", async () => {
    mockCase([task("t1", [{ kind: "comment", text: "please start" }])]);
    expect(await renderCase("c1")).toContain(
      'started for: message in jira:LD-7: "please start"'
    );
  });

  it("falls back to the channel without messages", async () => {
    mockCase([task("t1", null)]);
    expect(await renderCase("c1")).toContain("started for: jira:LD-7");
  });

  it("shows why a task was cancelled", async () => {
    mockCase([
      task("t1", [], {
        status: OrchestratorTaskStatus.Cancelled,
        result: {
          reply: null,
          questions: [],
          error: null,
          cancelled: "label removed",
        },
      }),
    ]);
    expect(await renderCase("c1")).toContain("— cancelled: label removed");
  });

  it("shows which message a task answers", async () => {
    mockCase([
      task("t1", [], {
        status: OrchestratorTaskStatus.Succeeded,
        result: { reply: null, questions: [], error: null, replyTo: "10500" },
      }),
    ]);
    expect(await renderCase("c1")).toContain("answers ref 10500");
  });

  it("marks questions asked on the item", async () => {
    mockCase([
      task("t1", [], {
        status: OrchestratorTaskStatus.Succeeded,
        result: {
          reply: null,
          questions: [
            { id: "q1", question: "A?", commentId: "10234" },
            { id: "q2", question: "B?" },
          ],
          error: null,
        },
      }),
    ]);
    expect(await renderCase("c1")).toContain(
      "questions: q1 (asked on the item, comment 10234), q2"
    );
  });

  it("ends a task line with the names of its files", async () => {
    mockCase([
      task("t1", [], {
        status: OrchestratorTaskStatus.Succeeded,
        result: {
          reply: null,
          questions: [],
          error: null,
          files: [
            { name: "PRD-LD-5.md", size: 10, storageKey: "k", skipped: null },
          ],
        },
      }),
    ]);
    expect(await renderCase("c1")).toContain(" — files: PRD-LD-5.md —");
  });

  it("marks a message written in AgentFlow", async () => {
    mocks.findUnique.mockResolvedValue({
      organizationId: "org-1",
      title: "LD-7",
      status: "open",
      sourceKey: null,
      notes: "",
      conversations: [
        {
          channelKey: "jira:LD-7",
          status: "idle",
          channel: null,
          messages: [
            {
              actor: "Sang",
              kind: "message",
              text: "hello",
              payload: { via: OrchestratorMessageVia.AgentFlow },
              createdAt: new Date("2026-10-23T08:00:00.000Z"),
            },
          ],
        },
      ],
      tasks: [],
      decisions: [],
    });
    expect(await renderCase("c1")).toContain("Sang (AgentFlow) (message)");
  });

  it("renders tasks and decisions before conversations", async () => {
    mocks.findUnique.mockResolvedValue({
      organizationId: "org-1",
      title: "LD-7",
      status: "open",
      sourceKey: null,
      notes: "",
      conversations: [
        {
          channelKey: "jira:LD-7:item",
          status: "idle",
          channel: null,
          messages: [],
        },
      ],
      tasks: [],
      decisions: [
        { id: "d1", question: "ok?", status: "pending", decidedBy: null },
      ],
    });
    const out = await renderCase("c1");
    expect(out.indexOf("## Tasks")).toBeLessThan(out.indexOf("## Decisions"));
    expect(out.indexOf("## Decisions")).toBeLessThan(
      out.indexOf("## Conversations")
    );
  });

  it("shows a decision's draft and its result", async () => {
    mocks.findUnique.mockResolvedValue({
      organizationId: "org-1",
      title: "LD-7",
      status: "open",
      sourceKey: null,
      notes: "",
      conversations: [],
      tasks: [],
      decisions: [
        {
          id: "d1",
          question: "ok?",
          status: "approved",
          decidedBy: "Ann",
          draft: {
            turnId: "3f1c0a52-8d0e-4f4e-9a57-0c5c1d2e7b11",
            itemKey: "LD-7",
            comment: { text: "Hello", replyTo: null, attachments: [] },
            transitionName: "Planning",
          },
          draftResult: {
            outcome: "done",
            commentRef: "123",
            transition: { from: null, to: "Planning" },
            error: null,
            carriedOutAt: "2026-11-09T00:00:00.000Z",
          },
        },
        {
          id: "d2",
          question: "plain?",
          status: "pending",
          decidedBy: null,
          draft: null,
          draftResult: null,
        },
      ],
    });
    const out = await renderCase("c1");
    expect(out).toContain(
      "ok?\u0020— draft: comment (5 chars) + move to Planning; posted (reference 123)"
    );
    expect(out).toContain("plain?");
    expect(out).not.toContain("plain? — draft");
  });

  it("shows a handoff message with its kind", async () => {
    mocks.findUnique.mockResolvedValue({
      organizationId: "org-1",
      title: "LD-7",
      status: "open",
      sourceKey: null,
      notes: "",
      conversations: [
        {
          channelKey: "jira:LD-7:item",
          status: "idle",
          channel: null,
          messages: [
            {
              actor: "An",
              kind: OrchestratorMessageKind.Handoff,
              text: "change it",
              payload: null,
              createdAt: new Date("2026-10-23T08:00:00.000Z"),
            },
          ],
        },
      ],
      tasks: [],
      decisions: [],
    });
    expect(await renderCase("c1")).toContain("(handoff):");
  });
});
