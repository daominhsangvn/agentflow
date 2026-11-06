import type {
  OrchestratorCaseDetail,
  OrchestratorCaseMessage,
  OrchestratorCaseTask,
} from "@repo/api/src/types/orchestrator";

export const AgentTimelineEntryKind = {
  ToAgent: "to_agent",
  FromAgent: "from_agent",
  AskedByPerson: "asked_by_person",
  Answer: "answer",
} as const;
export type AgentTimelineEntryKind =
  (typeof AgentTimelineEntryKind)[keyof typeof AgentTimelineEntryKind];

export type AgentTimelineEntry =
  | {
      kind: typeof AgentTimelineEntryKind.ToAgent;
      id: string;
      at: string;
      task: OrchestratorCaseTask;
    }
  | {
      kind: typeof AgentTimelineEntryKind.FromAgent;
      id: string;
      at: string;
      task: OrchestratorCaseTask;
    }
  | {
      kind:
        | typeof AgentTimelineEntryKind.AskedByPerson
        | typeof AgentTimelineEntryKind.Answer;
      id: string;
      at: string;
      message: OrchestratorCaseMessage;
    };

export type AgentTimeline = {
  entries: AgentTimelineEntry[];
  openQuestionTasks: OrchestratorCaseTask[];
  conversationId: string | null;
};

/** One agent's view of a case: what it was sent, what it returned, and the people's side. */
export function buildAgentTimeline(
  detail: OrchestratorCaseDetail,
  computeTargetId: string
): AgentTimeline {
  const tasks = detail.tasks.filter(
    (task) => task.computeTargetId === computeTargetId
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const entries: AgentTimelineEntry[] = [];
  for (const task of tasks) {
    entries.push(...taskEntries(task));
  }
  for (const conversation of detail.conversations) {
    for (const message of conversation.messages) {
      const entry = messageEntry(message, computeTargetId, taskIds);
      if (entry) {
        entries.push(entry);
      }
    }
  }
  entries.sort(compareEntries);
  return {
    entries,
    openQuestionTasks: tasks.filter((task) => task.openQuestionCount > 0),
    conversationId: newestTask(tasks)?.conversationId ?? null,
  };
}

function taskEntries(task: OrchestratorCaseTask): AgentTimelineEntry[] {
  const out: AgentTimelineEntry[] = [
    {
      kind: AgentTimelineEntryKind.ToAgent,
      id: `${task.id}:to`,
      at: task.createdAt,
      task,
    },
  ];
  if (task.finishedAt) {
    out.push({
      kind: AgentTimelineEntryKind.FromAgent,
      id: `${task.id}:from`,
      at: task.finishedAt,
      task,
    });
  }
  return out;
}

function messageEntry(
  message: OrchestratorCaseMessage,
  computeTargetId: string,
  taskIds: Set<string>
): AgentTimelineEntry | null {
  if (message.toAgentId === computeTargetId) {
    return {
      kind: AgentTimelineEntryKind.AskedByPerson,
      id: message.id,
      at: message.createdAt,
      message,
    };
  }
  if (message.answeredTaskIds?.some((id) => taskIds.has(id))) {
    return {
      kind: AgentTimelineEntryKind.Answer,
      id: message.id,
      at: message.createdAt,
      message,
    };
  }
  return null;
}

function newestTask(
  tasks: OrchestratorCaseTask[]
): OrchestratorCaseTask | null {
  let newest: OrchestratorCaseTask | null = null;
  for (const task of tasks) {
    if (!newest || task.createdAt > newest.createdAt) {
      newest = task;
    }
  }
  return newest;
}

function compareEntries(a: AgentTimelineEntry, b: AgentTimelineEntry): number {
  if (a.at !== b.at) {
    return a.at < b.at ? -1 : 1;
  }
  return a.id.localeCompare(b.id);
}
