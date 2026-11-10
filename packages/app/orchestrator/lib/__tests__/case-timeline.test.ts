import {
  type OrchestratorCaseConversation,
  type OrchestratorCaseMessage,
  type OrchestratorCaseTask,
  type OrchestratorCaseTurn,
  OrchestratorConversationStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  OrchestratorTurnEnd,
  OrchestratorTurnStatus,
} from "@repo/api/src/types/orchestrator";
import { describe, expect, it } from "vitest";
import {
  buildConversationTimeline,
  CaseTimelineEntryKind,
  entryKey,
  personLine,
  TurnOutcome,
  turnOutcome,
} from "../case-timeline";

const CONV = "conv-1";

function message(
  id: string,
  createdAt: string,
  overrides: Partial<OrchestratorCaseMessage> = {}
): OrchestratorCaseMessage {
  return {
    id,
    conversationId: CONV,
    origin: OrchestratorMessageOrigin.External,
    kind: OrchestratorMessageKind.Message,
    actor: null,
    text: id,
    turnId: null,
    createdAt,
    ...overrides,
  };
}

function turn(
  id: string,
  startedAt: string,
  overrides: Partial<OrchestratorCaseTurn> = {}
): OrchestratorCaseTurn {
  return {
    id,
    conversationId: CONV,
    status: OrchestratorTurnStatus.Succeeded,
    ended: null,
    summary: null,
    error: null,
    usage: null,
    runnerName: null,
    startedAt,
    finishedAt: null,
    ...overrides,
  };
}

function task(
  id: string,
  turnId: string | null,
  overrides: Partial<OrchestratorCaseTask> = {}
): OrchestratorCaseTask {
  return {
    id,
    conversationId: CONV,
    turnId,
    status: OrchestratorTaskStatus.Queued,
    runnerName: null,
    computeTargetId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    inputs: [],
    replyTo: null,
    replyToMessageId: null,
    ...overrides,
  } as unknown as OrchestratorCaseTask;
}

function conversation(
  messages: OrchestratorCaseMessage[],
  turns: OrchestratorCaseTurn[]
): OrchestratorCaseConversation {
  return {
    id: CONV,
    channelKey: "teams:1",
    status: OrchestratorConversationStatus.Idle,
    createdAt: "2026-01-01T00:00:00.000Z",
    messages,
    turns,
  } as unknown as OrchestratorCaseConversation;
}

describe("buildConversationTimeline", () => {
  it("sorts a turn block after the inputs it consumed", () => {
    const done = task("k1", "t0", {
      status: OrchestratorTaskStatus.Succeeded,
      finishedAt: "2026-01-01T00:00:02.000Z",
    });
    const { entries } = buildConversationTimeline(
      conversation(
        [
          message("in", "2026-01-01T00:00:02.005Z", {
            origin: OrchestratorMessageOrigin.Internal,
            kind: OrchestratorMessageKind.TaskResults,
            turnId: "t1",
          }),
        ],
        [
          turn("t0", "2026-01-01T00:00:00.000Z"),
          turn("t1", "2026-01-01T00:00:02.000Z"),
        ]
      ),
      [done]
    );

    const keys = entries.map(entryKey);
    expect(keys).toEqual(["o-t0", "a-k1", "o-t1"]);
    const block = entries[2];
    expect(block?.at).toBe("2026-01-01T00:00:02.005Z");
    expect(
      block?.kind === CaseTimelineEntryKind.Orchestrator
        ? block.block.inputs.map((m) => m.id)
        : []
    ).toEqual(["in"]);
  });

  it("puts a person first at the same instant", () => {
    const at = "2026-01-01T00:00:01.000Z";
    const { entries } = buildConversationTimeline(
      conversation([message("m", at, { turnId: "t1" })], [turn("t1", at)]),
      []
    );

    expect(entries.map((e) => e.kind)).toEqual([
      CaseTimelineEntryKind.Person,
      CaseTimelineEntryKind.Orchestrator,
    ]);
  });

  it("files turn outputs into the block, not into entries", () => {
    const internal = (id: string, kind: OrchestratorMessageKind) =>
      message(id, "2026-01-01T00:00:03.000Z", {
        origin: OrchestratorMessageOrigin.Internal,
        kind,
        turnId: "t1",
      });
    const { entries } = buildConversationTimeline(
      conversation(
        [
          internal("r", OrchestratorMessageKind.Reply),
          internal("x", OrchestratorMessageKind.ToolRefused),
          internal("d", OrchestratorMessageKind.Document),
          internal("s", OrchestratorMessageKind.StatusChanged),
        ],
        [turn("t1", "2026-01-01T00:00:02.000Z")]
      ),
      []
    );

    expect(entries).toHaveLength(1);
    const first = entries[0];
    if (first?.kind !== CaseTimelineEntryKind.Orchestrator) {
      throw new Error("expected an orchestrator entry");
    }
    expect(first.block.replies.map((m) => m.id)).toEqual(["r"]);
    expect(first.block.refusals.map((m) => m.id)).toEqual(["x"]);
    expect(first.block.notes.map((m) => m.id)).toEqual(["d", "s"]);
  });

  it("adds Agent entries only for finished tasks with a loaded turn", () => {
    const { entries, unassignedTasks } = buildConversationTimeline(
      conversation([], [turn("t1", "2026-01-01T00:00:02.000Z")]),
      [
        task("k1", "t1", {
          status: OrchestratorTaskStatus.Succeeded,
          finishedAt: "2026-01-01T00:00:05.000Z",
        }),
        task("k4", "t1", { status: OrchestratorTaskStatus.Running }),
        task("k2", "gone", { status: OrchestratorTaskStatus.Failed }),
        task("k3", null, { status: OrchestratorTaskStatus.Succeeded }),
      ]
    );

    const agent = entries.filter((e) => e.kind === CaseTimelineEntryKind.Agent);
    expect(agent.map(entryKey)).toEqual(["a-k1"]);
    expect(agent[0]?.at).toBe("2026-01-01T00:00:05.000Z");
    const block = entries.find(
      (e) => e.kind === CaseTimelineEntryKind.Orchestrator
    );
    expect(
      block?.kind === CaseTimelineEntryKind.Orchestrator
        ? block.block.tasks.map((t) => t.id)
        : []
    ).toEqual(["k1", "k4"]);
    expect(unassignedTasks.map((t) => t.id)).toEqual(["k2", "k3"]);
  });

  it("shows a reply without a loaded turn as an orchestrator entry", () => {
    const { entries } = buildConversationTimeline(
      conversation(
        [
          message("r", "2026-01-01T00:00:03.000Z", {
            origin: OrchestratorMessageOrigin.Internal,
            kind: OrchestratorMessageKind.Reply,
          }),
        ],
        []
      ),
      []
    );

    const first = entries[0];
    expect(first?.kind).toBe(CaseTimelineEntryKind.Orchestrator);
    expect(
      first?.kind === CaseTimelineEntryKind.Orchestrator
        ? first.block.turn
        : "x"
    ).toBeNull();
  });
});

describe("turnOutcome", () => {
  it.each([
    [OrchestratorTurnStatus.Running, null, TurnOutcome.Working],
    [OrchestratorTurnStatus.Failed, null, TurnOutcome.Failed],
    [OrchestratorTurnStatus.Superseded, null, TurnOutcome.Superseded],
    [OrchestratorTurnStatus.Succeeded, null, TurnOutcome.Done],
    [
      OrchestratorTurnStatus.Succeeded,
      OrchestratorTurnEnd.WaitTasks,
      TurnOutcome.WaitingForAgents,
    ],
    [
      OrchestratorTurnStatus.Succeeded,
      OrchestratorTurnEnd.WaitHuman,
      TurnOutcome.WaitingForPeople,
    ],
    [
      OrchestratorTurnStatus.Succeeded,
      OrchestratorTurnEnd.Close,
      TurnOutcome.Closed,
    ],
  ])("maps %s / %s to %s", (status, ended, expected) => {
    expect(
      turnOutcome(turn("t", "2026-01-01T00:00:00.000Z", { status, ended }))
    ).toBe(expected);
  });
});

describe("personLine", () => {
  it("strips the actor from a ticket change", () => {
    const line = personLine(
      message("m", "2026-01-01T00:00:00.000Z", {
        kind: OrchestratorMessageKind.StatusChanged,
        actor: "Ann",
        text: "Status changed: To Do → Done (by Ann)",
      }),
      []
    );
    expect(line).toBe("Status changed: To Do → Done");
  });

  it("names the agent whose questions were answered", () => {
    const line = personLine(
      message("m", "2026-01-01T00:00:00.000Z", { answeredTaskIds: ["k1"] }),
      [task("k1", "t1", { runnerName: "dev-agent" })]
    );
    expect(line).toBe("Answered questions of dev-agent");
  });

  it("describes a case-page message", () => {
    const line = personLine(
      message("m", "2026-01-01T00:00:00.000Z", {
        via: OrchestratorMessageVia.AgentFlow,
      }),
      []
    );
    expect(line).toBe("Message on the case page");
  });
});
