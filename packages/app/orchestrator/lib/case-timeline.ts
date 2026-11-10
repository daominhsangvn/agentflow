import {
  type OrchestratorCaseConversation,
  type OrchestratorCaseMessage,
  type OrchestratorCaseTask,
  type OrchestratorCaseTurn,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  OrchestratorTurnEnd,
  OrchestratorTurnStatus,
} from "@repo/api/src/types/orchestrator";

export const CaseTimelineEntryKind = {
  Person: "person",
  Orchestrator: "orchestrator",
  Agent: "agent",
} as const;
export type CaseTimelineEntryKind =
  (typeof CaseTimelineEntryKind)[keyof typeof CaseTimelineEntryKind];

export const TurnOutcome = {
  Working: "working",
  WaitingForAgents: "waiting_for_agents",
  WaitingForPeople: "waiting_for_people",
  Closed: "closed",
  Done: "done",
  Failed: "failed",
  Superseded: "superseded",
} as const;
export type TurnOutcome = (typeof TurnOutcome)[keyof typeof TurnOutcome];

export type OrchestratorBlock = {
  /** turn.id, or `orphan-${turnId ?? message.id}` when the turn is not loaded. */
  id: string;
  turn: OrchestratorCaseTurn | null;
  replies: OrchestratorCaseMessage[];
  refusals: OrchestratorCaseMessage[];
  /** Documents, handoffs and the orchestrator's own ticket changes. */
  notes: OrchestratorCaseMessage[];
  /** CaseNotify and Handoff inputs (also in `inputs`). */
  notices: OrchestratorCaseMessage[];
  /** All internal inputs this turn claimed. */
  inputs: OrchestratorCaseMessage[];
  tasks: OrchestratorCaseTask[];
};

export type CaseTimelineEntry =
  | {
      kind: typeof CaseTimelineEntryKind.Person;
      at: string;
      message: OrchestratorCaseMessage;
      line: string;
    }
  | {
      kind: typeof CaseTimelineEntryKind.Orchestrator;
      at: string;
      block: OrchestratorBlock;
    }
  | {
      kind: typeof CaseTimelineEntryKind.Agent;
      at: string;
      task: OrchestratorCaseTask;
    };

export type ConversationTimeline = {
  entries: CaseTimelineEntry[];
  /** Tasks whose turn is not in the loaded list (or that have no turn). */
  unassignedTasks: OrchestratorCaseTask[];
};

export const UNKNOWN_AGENT = "Agent";
export const UNKNOWN_PERSON = "Someone";
const SOME_AGENT = "an agent";

const MessageRole = {
  Person: "person",
  Output: "output",
  Input: "input",
} as const;
type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

const OUTPUT_KINDS: ReadonlySet<OrchestratorMessageKind> = new Set([
  OrchestratorMessageKind.Reply,
  OrchestratorMessageKind.ToolRefused,
  OrchestratorMessageKind.Document,
  OrchestratorMessageKind.HandoffSent,
  OrchestratorMessageKind.StatusChanged,
  OrchestratorMessageKind.LabelAdded,
  OrchestratorMessageKind.LabelRemoved,
]);

const TICKET_CHANGE_KINDS: ReadonlySet<OrchestratorMessageKind> = new Set([
  OrchestratorMessageKind.StatusChanged,
  OrchestratorMessageKind.LabelAdded,
  OrchestratorMessageKind.LabelRemoved,
]);

const NOTICE_KINDS: ReadonlySet<OrchestratorMessageKind> = new Set([
  OrchestratorMessageKind.CaseNotify,
  OrchestratorMessageKind.Handoff,
]);

const TERMINAL_TASK_STATUSES: ReadonlySet<OrchestratorTaskStatus> = new Set([
  OrchestratorTaskStatus.Succeeded,
  OrchestratorTaskStatus.Failed,
  OrchestratorTaskStatus.Cancelled,
]);

const TURN_END_OUTCOMES: Record<OrchestratorTurnEnd, TurnOutcome> = {
  [OrchestratorTurnEnd.WaitTasks]: TurnOutcome.WaitingForAgents,
  [OrchestratorTurnEnd.WaitHuman]: TurnOutcome.WaitingForPeople,
  [OrchestratorTurnEnd.Close]: TurnOutcome.Closed,
};

const ENTRY_RANK: Record<CaseTimelineEntryKind, number> = {
  [CaseTimelineEntryKind.Person]: 0,
  [CaseTimelineEntryKind.Agent]: 1,
  [CaseTimelineEntryKind.Orchestrator]: 2,
};

/**
 * Builds the conversation timeline: one row per person message, one block per
 * orchestrator turn (its outputs, inputs and started tasks) and one entry per
 * finished task. Internal inputs are not rows; they live in the block of the
 * turn that consumed them.
 */
export function buildConversationTimeline(
  conversation: OrchestratorCaseConversation,
  tasks: OrchestratorCaseTask[]
): ConversationTimeline {
  const own = tasks
    .filter((task) => task.conversationId === conversation.id)
    .sort(byCreatedAt);
  const turnIds = new Set(conversation.turns.map((turn) => turn.id));
  const hasTurn = (task: OrchestratorCaseTask) =>
    task.turnId !== null && turnIds.has(task.turnId);

  const entries: CaseTimelineEntry[] = [
    ...personEntries(conversation.messages, tasks),
    ...turnBlocks(conversation, own).map(
      (block): CaseTimelineEntry => ({
        kind: CaseTimelineEntryKind.Orchestrator,
        at: blockTime(block, conversation.messages),
        block,
      })
    ),
    ...orphanBlocks(conversation.messages, turnIds),
    ...own.filter(hasTurn).filter(isTerminal).map(agentEntry),
  ];
  entries.sort(compareEntries);

  return { entries, unassignedTasks: own.filter((task) => !hasTurn(task)) };
}

export function entryKey(entry: CaseTimelineEntry): string {
  if (entry.kind === CaseTimelineEntryKind.Person) {
    return `p-${entry.message.id}`;
  }
  if (entry.kind === CaseTimelineEntryKind.Orchestrator) {
    return `o-${entry.block.id}`;
  }
  return `a-${entry.task.id}`;
}

export function turnOutcome(turn: OrchestratorCaseTurn): TurnOutcome {
  if (turn.status === OrchestratorTurnStatus.Running) {
    return TurnOutcome.Working;
  }
  if (turn.status === OrchestratorTurnStatus.Failed) {
    return TurnOutcome.Failed;
  }
  if (turn.status === OrchestratorTurnStatus.Superseded) {
    return TurnOutcome.Superseded;
  }
  return turn.ended === null ? TurnOutcome.Done : TURN_END_OUTCOMES[turn.ended];
}

export function agentName(task: OrchestratorCaseTask): string {
  return task.runnerName ?? UNKNOWN_AGENT;
}

export function personName(message: OrchestratorCaseMessage): string {
  return message.actor ?? UNKNOWN_PERSON;
}

export function stripActorSuffix(text: string, actor: string | null): string {
  return actor ? text.replaceAll(` (by ${actor})`, "") : text;
}

/** What a person row says they did, in a few words. */
export function personLine(
  message: OrchestratorCaseMessage,
  tasks: OrchestratorCaseTask[]
): string {
  if (TICKET_CHANGE_KINDS.has(message.kind)) {
    return stripActorSuffix(message.text, message.actor).split("\n").join("; ");
  }
  if (message.kind !== OrchestratorMessageKind.Message) {
    return "Message";
  }
  if (message.answeredTaskIds && message.answeredTaskIds.length > 0) {
    return `Answered questions of ${answeredAgents(message.answeredTaskIds, tasks)}`;
  }
  if (message.toAgentId) {
    const target = tasks.find(
      (task) => task.computeTargetId === message.toAgentId
    );
    return `Message to ${target?.runnerName ?? SOME_AGENT}`;
  }
  if (message.via === OrchestratorMessageVia.AgentFlow) {
    return "Message on the case page";
  }
  return "Comment on the ticket";
}

function answeredAgents(
  taskIds: string[],
  tasks: OrchestratorCaseTask[]
): string {
  const names = new Set<string>();
  for (const task of tasks) {
    if (taskIds.includes(task.id)) {
      names.add(agentName(task));
    }
  }
  return names.size > 0 ? [...names].join(", ") : SOME_AGENT;
}

function messageRole(message: OrchestratorCaseMessage): MessageRole {
  if (message.origin === OrchestratorMessageOrigin.External) {
    return MessageRole.Person;
  }
  return OUTPUT_KINDS.has(message.kind)
    ? MessageRole.Output
    : MessageRole.Input;
}

function personEntries(
  messages: OrchestratorCaseMessage[],
  tasks: OrchestratorCaseTask[]
): CaseTimelineEntry[] {
  return messages
    .filter((message) => messageRole(message) === MessageRole.Person)
    .map(
      (message): CaseTimelineEntry => ({
        kind: CaseTimelineEntryKind.Person,
        at: message.createdAt,
        message,
        line: personLine(message, tasks),
      })
    );
}

function turnBlocks(
  conversation: OrchestratorCaseConversation,
  own: OrchestratorCaseTask[]
): OrchestratorBlock[] {
  return conversation.turns.map((turn) =>
    makeBlock(
      turn.id,
      turn,
      conversation.messages.filter(
        (message) =>
          message.turnId === turn.id &&
          messageRole(message) !== MessageRole.Person
      ),
      own.filter((task) => task.turnId === turn.id)
    )
  );
}

function orphanBlocks(
  messages: OrchestratorCaseMessage[],
  turnIds: Set<string>
): CaseTimelineEntry[] {
  const groups = new Map<string, OrchestratorCaseMessage[]>();
  for (const message of messages) {
    const orphan =
      messageRole(message) === MessageRole.Output &&
      (message.turnId === null || !turnIds.has(message.turnId));
    if (orphan) {
      const key = `orphan-${message.turnId ?? message.id}`;
      groups.set(key, [...(groups.get(key) ?? []), message]);
    }
  }
  return [...groups.entries()].map(([id, group]): CaseTimelineEntry => {
    const sorted = [...group].sort(byCreatedAt);
    return {
      kind: CaseTimelineEntryKind.Orchestrator,
      at: sorted[0]?.createdAt ?? "",
      block: makeBlock(id, null, sorted, []),
    };
  });
}

function makeBlock(
  id: string,
  turn: OrchestratorCaseTurn | null,
  messages: OrchestratorCaseMessage[],
  tasks: OrchestratorCaseTask[]
): OrchestratorBlock {
  const sorted = [...messages].sort(byCreatedAt);
  const outputs = sorted.filter(
    (message) => messageRole(message) === MessageRole.Output
  );
  const inputs = sorted.filter(
    (message) => messageRole(message) === MessageRole.Input
  );
  const ofKind = (kind: OrchestratorMessageKind) =>
    outputs.filter((message) => message.kind === kind);
  return {
    id,
    turn,
    replies: ofKind(OrchestratorMessageKind.Reply),
    refusals: ofKind(OrchestratorMessageKind.ToolRefused),
    notes: outputs.filter(
      (message) =>
        message.kind !== OrchestratorMessageKind.Reply &&
        message.kind !== OrchestratorMessageKind.ToolRefused
    ),
    notices: inputs.filter((message) => NOTICE_KINDS.has(message.kind)),
    inputs,
    tasks,
  };
}

/** A turn starts after the inputs it consumed: take the latest of them. */
function blockTime(
  block: OrchestratorBlock,
  messages: OrchestratorCaseMessage[]
): string {
  const startedAt = block.turn?.startedAt ?? "";
  let latest = startedAt;
  for (const message of messages) {
    const consumed =
      message.turnId === block.turn?.id &&
      messageRole(message) !== MessageRole.Output;
    if (consumed && time(message.createdAt) > time(latest)) {
      latest = message.createdAt;
    }
  }
  return latest;
}

function isTerminal(task: OrchestratorCaseTask): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status);
}

function agentEntry(task: OrchestratorCaseTask): CaseTimelineEntry {
  return {
    kind: CaseTimelineEntryKind.Agent,
    at: task.finishedAt ?? task.createdAt,
    task,
  };
}

function time(value: string): number {
  return new Date(value).getTime();
}

function byCreatedAt(a: { createdAt: string }, b: { createdAt: string }) {
  return time(a.createdAt) - time(b.createdAt);
}

function compareEntries(a: CaseTimelineEntry, b: CaseTimelineEntry): number {
  const byTime = time(a.at) - time(b.at);
  if (byTime !== 0) {
    return byTime;
  }
  const byRank = ENTRY_RANK[a.kind] - ENTRY_RANK[b.kind];
  if (byRank !== 0) {
    return byRank;
  }
  return entryKey(a).localeCompare(entryKey(b));
}
