import { z } from "zod";

import type { AgentKind } from "./agent-fleet.ts";
import type {
  WorkflowRunLoopRef,
  WorkflowRunPullRequest,
  WorkflowRunSession,
} from "./workflow.ts";

/**
 * The project orchestrator's runtime (docs/orchestrator.md): cases (a ticket
 * or a thread of work), conversations (where messages come from and answers
 * go: a comment thread, a Teams thread, a ticket), messages (external and
 * internal requests), turns (one run of the orchestrator's agent on its
 * runner), anchors (the comments the orchestrator posted, so a reply finds
 * its conversation), tasks (a runner command the orchestrator asked for),
 * waits (what a conversation waits for before its next turn) and decisions
 * (an approval asked of people).
 */

export const OrchestratorCaseStatus = {
  Open: "open",
  Closed: "closed",
} as const;
export type OrchestratorCaseStatus =
  (typeof OrchestratorCaseStatus)[keyof typeof OrchestratorCaseStatus];

export const OrchestratorConversationStatus = {
  /** Nothing to do until a message arrives. */
  Idle: "idle",
  /** A turn runs. */
  Turn: "turn",
  /** Waits for tasks or for people (its waits say which). */
  Waiting: "waiting",
  Closed: "closed",
} as const;
export type OrchestratorConversationStatus =
  (typeof OrchestratorConversationStatus)[keyof typeof OrchestratorConversationStatus];

/** Where a message comes from: a person or a system outside, or AgentFlow. */
export const OrchestratorMessageOrigin = {
  External: "external",
  Internal: "internal",
} as const;
export type OrchestratorMessageOrigin =
  (typeof OrchestratorMessageOrigin)[keyof typeof OrchestratorMessageOrigin];

export const OrchestratorMessageKind = {
  /** A mention, a reply, a post: someone asks something. */
  Message: "message",
  /** The tasks a wait named are done (or one failed): their results. */
  TaskResults: "task_results",
  /** People decided on a decision the orchestrator asked for. */
  Decision: "decision",
  /** A wait reached its deadline. */
  Deadline: "deadline",
  /** The orchestrator's own message, posted in the thread (reply). */
  Reply: "reply",
  /** The ticket moved to another status. */
  StatusChanged: "status_changed",
  /** A label was added to the ticket. */
  LabelAdded: "label_added",
  /** A label was removed from the ticket. */
  LabelRemoved: "label_removed",
  /** A tool call of the orchestrator that was refused (audit; never wakes a turn). */
  ToolRefused: "tool_refused",
  /** A page the orchestrator published (page_publish). */
  Document: "document",
  /** Another case of this workflow notified this one (case_notify); wakes a turn. */
  CaseNotify: "case_notify",
  /** A change request people confirmed in a side conversation about this item (case_handoff); wakes a turn. */
  Handoff: "handoff",
  /** The side conversation's record that it sent a confirmed summary (case_handoff; audit, never wakes a turn). */
  HandoffSent: "handoff_sent",
  /** A task's agent asked questions on the item itself (questions.json commentId); the Case's record. Internal, never wakes a turn on its own. */
  TaskAsked: "task_asked",
} as const;
export type OrchestratorMessageKind =
  (typeof OrchestratorMessageKind)[keyof typeof OrchestratorMessageKind];

export const OrchestratorTurnStatus = {
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
  /** Stopped for a newer message; the next turn takes its messages too. */
  Superseded: "superseded",
} as const;
export type OrchestratorTurnStatus =
  (typeof OrchestratorTurnStatus)[keyof typeof OrchestratorTurnStatus];

/** How a turn ended: what the conversation does next. */
export const OrchestratorTurnEnd = {
  /** Waits for tasks (wait_for). */
  WaitTasks: "wait_tasks",
  /** Waits for a person (wait_human, or a turn that declared nothing). */
  WaitHuman: "wait_human",
  /** The case is done (close_case). */
  Close: "close",
} as const;
export type OrchestratorTurnEnd =
  (typeof OrchestratorTurnEnd)[keyof typeof OrchestratorTurnEnd];

export const OrchestratorTaskStatus = {
  /** Waits for its runner (a personal runner that runs one task at a time). */
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
  /** Stopped by task_cancel on a ticket change; never resumed. */
  Cancelled: "cancelled",
} as const;
export type OrchestratorTaskStatus =
  (typeof OrchestratorTaskStatus)[keyof typeof OrchestratorTaskStatus];

export const OrchestratorWaitKind = {
  /** Every task is done (or one failed, with onFailure wake). */
  All: "all",
  /** The first task is done. */
  Any: "any",
} as const;
export type OrchestratorWaitKind =
  (typeof OrchestratorWaitKind)[keyof typeof OrchestratorWaitKind];

export const OrchestratorDecisionStatus = {
  Pending: "pending",
  Approved: "approved",
  Rejected: "rejected",
} as const;
export type OrchestratorDecisionStatus =
  (typeof OrchestratorDecisionStatus)[keyof typeof OrchestratorDecisionStatus];

/** Where a decision was given. */
export const OrchestratorDecisionVia = {
  /** An admin pressed the button in AgentFlow. */
  Button: "button",
  /** Someone said it in the thread; the orchestrator recorded it. */
  Message: "message",
} as const;
export type OrchestratorDecisionVia =
  (typeof OrchestratorDecisionVia)[keyof typeof OrchestratorDecisionVia];

// ---------------------------------------------------------------------------
// A turn on the orchestrator's runner (desktop command)
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_TURN_GATEWAY_PATH = "/api/gateway/orchestrator/turn";
export const ORCHESTRATOR_TURN_OPERATION_ID = "orchestrator_turn";
export const ORCHESTRATOR_TURN_PROMPT_MAX = 200_000;
/** Stops a running turn for a newer message (concurrency `supersede`). */
export const ORCHESTRATOR_TURN_CANCEL_GATEWAY_PATH =
  "/api/gateway/orchestrator/turn/cancel";
export const ORCHESTRATOR_TURN_CANCEL_OPERATION_ID = "orchestrator_turn_cancel";
export const orchestratorTurnCancelRequestSchema = z.object({
  turnId: z.uuid(),
});
/** The error of a turn stopped for a newer message. */
export const ORCHESTRATOR_TURN_STOPPED_ERROR =
  "The turn was stopped for a newer message.";
export const ORCHESTRATOR_TURN_ANSWER_MAX = 8000;
export const ORCHESTRATOR_TURN_ERROR_MAX = 2000;
/** The MCP server name the orchestrator's tools are served under. */
export const ORCHESTRATOR_MCP_SERVER_NAME = "agentflow_orchestrator";

export const orchestratorTurnRequestSchema = z.object({
  turnId: z.uuid(),
  /** Names the turn's working folder; sessions resume per project. */
  projectId: z.uuid(),
  /** The conversation's Claude session to resume; null: a new session. */
  sessionId: z.string().min(1).max(100).nullable(),
  prompt: z.string().min(1).max(ORCHESTRATOR_TURN_PROMPT_MAX),
  /** How long the turn may run on the computer. */
  timeoutMs: z.number().int().positive(),
});
export type OrchestratorTurnRequest = z.infer<
  typeof orchestratorTurnRequestSchema
>;

/** The `result` line of the computer's answer. */
export const orchestratorTurnResultSchema = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("result"),
    ok: z.literal(true),
    /** The agent's final note (what it did); its answers went out by tool. */
    answer: z.string().max(ORCHESTRATOR_TURN_ANSWER_MAX),
    /** The Claude session the next turn of the conversation resumes. */
    sessionId: z.string().max(100).nullable(),
    costUsd: z.number().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("result"),
    ok: z.literal(false),
    error: z.string().max(ORCHESTRATOR_TURN_ERROR_MAX),
    retryable: z.boolean(),
    sessionId: z.string().max(100).nullable(),
  }),
]);
export type OrchestratorTurnResult = z.infer<
  typeof orchestratorTurnResultSchema
>;

// ---------------------------------------------------------------------------
// The orchestrator's tools (an MCP session per turn)
// ---------------------------------------------------------------------------

/** Prefix of a turn's tool session token (`ost_…`). */
export const ORCHESTRATOR_TOKEN_PREFIX = "ost_";
/** The runner exchanges its turn for the tool session token here. */
export const ORCHESTRATOR_SESSION_ROUTE = "/desktop/orchestrator-sessions";
/** apps/mcp forwards a token's tool list and calls here. */
export const ORCHESTRATOR_TOOLS_SESSION_ROUTE = "/orchestrator-tools/session";
export const ORCHESTRATOR_TOOLS_CALL_ROUTE = "/orchestrator-tools/call";

export const orchestratorSessionRequestSchema = z.object({
  turnId: z.uuid(),
});

export const OrchestratorToolName = {
  CaseGet: "case_get",
  CaseUpdateNotes: "case_update_notes",
  ConversationAttachCase: "conversation_attach_case",
  RunnersList: "runners_list",
  SourceItemGet: "source_item_get",
  Reply: "reply",
  TaskRun: "task_run",
  TaskGet: "task_get",
  TaskCancel: "task_cancel",
  WaitFor: "wait_for",
  WaitHuman: "wait_human",
  CloseCase: "close_case",
  RequestDecision: "request_decision",
  RecordDecision: "record_decision",
  EditReply: "edit_reply",
  PagePublish: "page_publish",
  PageGet: "page_get",
  PullRequestOpen: "pull_request_open",
  SourceItemTransition: "source_item_transition",
  SourceItemLabel: "source_item_label",
  SourceItemLink: "source_item_link",
  CaseNotify: "case_notify",
  CaseLookup: "case_lookup",
  CaseHandoff: "case_handoff",
} as const;
export type OrchestratorToolName =
  (typeof OrchestratorToolName)[keyof typeof OrchestratorToolName];

/**
 * Where a task's agent leaves its answer for the orchestrator (a workspace
 * path; on a personal runner it is in the task's own work directory).
 */
export const ORCHESTRATOR_TASK_REPLY_FILE =
  ".agentflow-ai/work/orchestrator-reply.md";
export const ORCHESTRATOR_TASK_REPLY_MAX = 30_000;

/** An admin's decision in AgentFlow (POST /orchestrator/decisions/{id}). */
export const decideOrchestratorDecisionInputSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().max(4000).optional(),
});
export type DecideOrchestratorDecisionInput = z.infer<
  typeof decideOrchestratorDecisionInputSchema
>;

// ---------------------------------------------------------------------------
// Case reads and admin actions (project -> Orchestrator, case page). All
// dates are ISO strings.
// ---------------------------------------------------------------------------

export type OrchestratorCaseSummary = {
  id: string;
  projectId: string;
  workflowId: string;
  title: string;
  sourceKey: string | null;
  status: OrchestratorCaseStatus;
  conversationCount: number;
  pendingDecisionCount: number;
  /** Queued + running tasks. */
  activeTaskCount: number;
  turnRunning: boolean;
  taskCount: number;
  turnCount: number;
  /** Known cost of the case's task sessions (loop cost when a loop has no session) and turns; null when none is known. */
  costUsd: number | null;
  /** Known input/output tokens of the case's task sessions (loop numbers when a loop has no session) and turns. */
  inputTokens: number;
  outputTokens: number;
  /** Active agent time: summed session (or loop) durations of the case's tasks plus its turns. */
  activeMs: number;
  createdAt: string;
  updatedAt: string;
  /** When the case was closed; null while open. */
  closedAt: string | null;
};

export type OrchestratorTurnUsage = {
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type OrchestratorCaseMessage = {
  id: string;
  conversationId: string;
  origin: OrchestratorMessageOrigin;
  kind: OrchestratorMessageKind;
  actor: string | null;
  text: string;
  turnId: string | null;
  createdAt: string;
  via?: OrchestratorMessageVia | null;
  /** Tasks whose questions this case-page message answered. */
  answeredTaskIds?: string[];
  /** The agent (compute target) a case-page message is addressed to. */
  toAgentId?: string | null;
};

export type OrchestratorCaseTurn = {
  id: string;
  conversationId: string;
  status: OrchestratorTurnStatus;
  ended: OrchestratorTurnEnd | null;
  summary: string | null;
  error: string | null;
  usage: OrchestratorTurnUsage | null;
  runnerName: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type OrchestratorCaseTaskFile = {
  name: string;
  size: number;
  /** False when the runner did not store it (see skipped). */
  stored: boolean;
  skipped: string | null;
};

export type OrchestratorCaseTask = {
  id: string;
  conversationId: string;
  turnId: string | null;
  command: string;
  args: string;
  prompt: string;
  mode: string;
  runnerName: string | null;
  computeTargetId: string | null;
  status: OrchestratorTaskStatus;
  fork: boolean;
  resumeTaskId: string | null;
  loopId: string | null;
  reply: string | null;
  files: OrchestratorCaseTaskFile[];
  filesOmitted: number;
  questions: Array<{
    id: string;
    question: string;
    options?: string[];
    commentId?: string;
  }>;
  error: string | null;
  /** Why a queued task has not started (a busy runner). */
  waiting: string | null;
  /** Questions no answer covers yet (server-owned). */
  openQuestionCount: number;
  createdAt: string;
  finishedAt: string | null;
};

export type OrchestratorCaseWait = {
  id: string;
  conversationId: string;
  kind: OrchestratorWaitKind;
  taskIds: string[];
  deadline: string | null;
  wakeOnFailure: boolean;
  firedAt: string | null;
  createdAt: string;
};

export type OrchestratorCaseDecision = {
  id: string;
  conversationId: string;
  question: string;
  status: OrchestratorDecisionStatus;
  via: OrchestratorDecisionVia | null;
  decidedBy: string | null;
  comment: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type OrchestratorCaseConversation = {
  id: string;
  channelKey: string;
  status: OrchestratorConversationStatus;
  createdAt: string;
  messages: OrchestratorCaseMessage[];
  turns: OrchestratorCaseTurn[];
};

export type OrchestratorCaseDetail = OrchestratorCaseSummary & {
  notes: string;
  project: { id: string; name: string };
  workflow: { id: string; name: string };
  conversations: OrchestratorCaseConversation[];
  tasks: OrchestratorCaseTask[];
  waits: OrchestratorCaseWait[];
  decisions: OrchestratorCaseDecision[];
  documents: OrchestratorCaseDocument[];
};

export const updateOrchestratorCaseInputSchema = z.object({
  status: z.enum(OrchestratorCaseStatus),
});
export type UpdateOrchestratorCaseInput = z.infer<
  typeof updateOrchestratorCaseInputSchema
>;

/** What happens to a new message while a turn on the same thread runs. */
export const OrchestratorConcurrency = {
  /** Stop the running turn; the next one handles both messages. */
  Supersede: "supersede",
  /** Let the running turn finish; the next one takes every new message. */
  Queue: "queue",
} as const;
export type OrchestratorConcurrency =
  (typeof OrchestratorConcurrency)[keyof typeof OrchestratorConcurrency];

export const ORCHESTRATOR_DEBOUNCE_SECONDS_DEFAULT = 20;
export const ORCHESTRATOR_DEBOUNCE_SECONDS_MAX = 600;
export const ORCHESTRATOR_TURN_TIMEOUT_MINUTES_DEFAULT = 10;
export const ORCHESTRATOR_TURN_TIMEOUT_MINUTES_MAX = 60;

/**
 * A change of the ticket itself (not a comment): the kinds of the
 * orchestrator's messages for them and the values of
 * agent.orchestrator.cancelOn.
 */
export const OrchestratorTicketChange = {
  StatusChanged: "status_changed",
  LabelAdded: "label_added",
  LabelRemoved: "label_removed",
} as const;
export type OrchestratorTicketChange =
  (typeof OrchestratorTicketChange)[keyof typeof OrchestratorTicketChange];

/** Ticket changes whose turn may cancel tasks when cancelOn is unset. */
export const ORCHESTRATOR_CANCEL_ON_DEFAULT: readonly OrchestratorTicketChange[] =
  [
    OrchestratorTicketChange.StatusChanged,
    OrchestratorTicketChange.LabelRemoved,
  ];

/** GET /orchestrator/cases/{id}/loops: the loops the case's tasks ran (Date fields, revived). */
export type OrchestratorCaseLoops = {
  loops: WorkflowRunLoopRef[];
  sessions: WorkflowRunSession[];
  pullRequests: WorkflowRunPullRequest[];
};

/** What a page published by the orchestrator is (shown in CASE.md and on the case page). */
export const OrchestratorDocumentKind = {
  Ticket: "ticket",
  Prd: "prd",
  Plan: "plan",
  TestPlan: "test_plan",
  TestRun: "test_run",
  Other: "other",
} as const;
export type OrchestratorDocumentKind =
  (typeof OrchestratorDocumentKind)[keyof typeof OrchestratorDocumentKind];

/** Display label of each document kind (CASE.md and the case page). */
export const DOCUMENT_KIND_LABELS: Record<OrchestratorDocumentKind, string> = {
  [OrchestratorDocumentKind.Ticket]: "Ticket page",
  [OrchestratorDocumentKind.Prd]: "PRD",
  [OrchestratorDocumentKind.Plan]: "Implementation plan",
  [OrchestratorDocumentKind.TestPlan]: "Test plan",
  [OrchestratorDocumentKind.TestRun]: "Test run",
  [OrchestratorDocumentKind.Other]: "Document",
};

/** A page the orchestrator published for the case (newest version of each page). */
export type OrchestratorCaseDocument = {
  pageId: string;
  title: string;
  url: string;
  kind: OrchestratorDocumentKind;
  version: number;
  attachments: string[];
  publishedAt: string;
};

export const ORCHESTRATOR_TASK_BLOCKED_PREFIX = "BLOCKED:";

export const OrchestratorCaseWaitingFor = {
  /** The case is closed. */
  Nothing: "nothing",
  /** A turn runs. */
  Turn: "turn",
  /** A decision is pending. */
  Decision: "decision",
  /** An unfired wait or active tasks. */
  Tasks: "tasks",
  /** A conversation is waiting for people. */
  Human: "human",
  /** Idle. */
  NextMessage: "next_message",
} as const;
export type OrchestratorCaseWaitingFor =
  (typeof OrchestratorCaseWaitingFor)[keyof typeof OrchestratorCaseWaitingFor];

export type OrchestratorCaseListItem = OrchestratorCaseSummary & {
  project: { id: string; name: string };
  workflow: { id: string; name: string };
  waitingFor: OrchestratorCaseWaitingFor;
  /** Machine names of the agents running or queued for the case's active tasks. */
  runningAgents: string[];
  /** The case needs a person (caseNeedsPersonWhere). */
  needsPerson: boolean;
  /** The newest wait_human asked of the case's conversations. */
  askedHuman: string | null;
  /** Every agent with a task in the case. */
  agents: OrchestratorCaseAgent[];
};

export type OrchestratorCaseAgent = {
  computeTargetId: string;
  activeTaskCount: number;
  openQuestionCount: number;
};

export const orchestratorCaseListQuerySchema = z
  .object({
    projectId: z.uuid().optional(),
    workflowId: z.uuid().optional(),
    status: z.enum(OrchestratorCaseStatus).optional(),
  })
  .strict();
export type OrchestratorCaseListQuery = z.infer<
  typeof orchestratorCaseListQuerySchema
>;

/** A message written on the case page in AgentFlow, or a reply shown there. */
export const OrchestratorMessageVia = {
  AgentFlow: "agentflow",
} as const;
export type OrchestratorMessageVia =
  (typeof OrchestratorMessageVia)[keyof typeof OrchestratorMessageVia];

/** Where a reply goes: the ticket's thread or the case page. */
export const OrchestratorReplyTarget = {
  Thread: "thread",
  CasePage: "case_page",
} as const;
export type OrchestratorReplyTarget =
  (typeof OrchestratorReplyTarget)[keyof typeof OrchestratorReplyTarget];

export const ORCHESTRATOR_CASE_MESSAGE_MAX = 4000;
export const ORCHESTRATOR_CASE_ANSWERS_MAX = 20;
export const ORCHESTRATOR_ASKED_HUMAN_MAX = 500;

export const postOrchestratorCaseMessageInputSchema = z
  .object({
    conversationId: z.uuid(),
    text: z.string().trim().max(ORCHESTRATOR_CASE_MESSAGE_MAX).default(""),
    answers: z
      .array(
        z.object({
          taskId: z.uuid(),
          questionId: z.string().trim().min(1).max(100),
          answer: z.string().trim().min(1).max(ORCHESTRATOR_CASE_MESSAGE_MAX),
        })
      )
      .max(ORCHESTRATOR_CASE_ANSWERS_MAX)
      .default([]),
    toAgentId: z.uuid().optional(),
  })
  .refine((input) => input.text.length > 0 || input.answers.length > 0, {
    message: "Write a message or answer a question",
  });
export type PostOrchestratorCaseMessageInput = z.input<
  typeof postOrchestratorCaseMessageInputSchema
>;

export type OrchestratorCaseMessagePosted = {
  messageId: string;
  conversationId: string;
};

export const orchestratorMessageViaPayloadSchema = z.looseObject({
  via: z.enum(OrchestratorMessageVia),
});

const orchestratorMessageAnswersPayloadSchema = z.looseObject({
  answers: z.array(z.looseObject({ taskId: z.string() })),
});

/** The tasks a case-page message answered (empty when it answered none). */
export function readOrchestratorMessageAnsweredTaskIds(
  payload: unknown
): string[] {
  const parsed = orchestratorMessageAnswersPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  return [...new Set(parsed.data.answers.map((answer) => answer.taskId))];
}

export function readOrchestratorMessageVia(
  payload: unknown
): OrchestratorMessageVia | null {
  const parsed = orchestratorMessageViaPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.via : null;
}

/** GET /workflows/{id}/agents: a node of the Agents tab diagram. */
export type WorkflowAgentMapNode = {
  computeTargetId: string;
  name: string;
  isOnline: boolean;
};

export type WorkflowAgentMapAgent = WorkflowAgentMapNode & {
  role: string | null;
  kind: AgentKind;
  declared: boolean;
};

export type WorkflowAgentMap = {
  orchestrator: WorkflowAgentMapNode | null;
  agents: WorkflowAgentMapAgent[];
};
