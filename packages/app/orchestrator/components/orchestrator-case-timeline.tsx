"use client";

import {
  type OrchestratorCaseConversation,
  type OrchestratorCaseMessage,
  type OrchestratorCaseTask,
  type OrchestratorCaseTaskInput,
  type OrchestratorCaseTurn,
  OrchestratorMessageKind,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  OrchestratorTurnStatus,
} from "@repo/api/src/types/orchestrator";
// Cross-slice: shared dialog and formatters.
import { ConfirmationDialog } from "@repo/app/shared/components/confirmation-dialog";
import { formatDateTime } from "@repo/app/shared/lib/date-utils";
import {
  formatCostPrecise,
  formatTokenCount,
} from "@repo/app/shared/lib/format-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { MarkdownContent } from "@repo/design-system/components/ui/primitives/markdown-content";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { type ReactNode, useState } from "react";
import remarkBreaks from "remark-breaks";
import { useCancelOrchestratorTurn } from "../hooks/use-orchestrator-cases";
import {
  agentName,
  buildConversationTimeline,
  type CaseTimelineEntry,
  CaseTimelineEntryKind,
  entryKey,
  type OrchestratorBlock,
  personName,
  stripActorSuffix,
  TurnOutcome,
  turnOutcome,
} from "../lib/case-timeline";
import { TaskQuestionsForm } from "./task-questions-form";

type BadgeVariant = "default" | "secondary" | "success" | "error" | "outline";

const TURN_OUTCOME_LABELS: Record<TurnOutcome, string> = {
  [TurnOutcome.Working]: "Working",
  [TurnOutcome.WaitingForAgents]: "Waiting for agents",
  [TurnOutcome.WaitingForPeople]: "Waiting for people",
  [TurnOutcome.Closed]: "Closed the case",
  [TurnOutcome.Done]: "Done",
  [TurnOutcome.Failed]: "Failed",
  [TurnOutcome.Superseded]: "Superseded by newer messages",
};

const TURN_OUTCOME_VARIANTS: Record<TurnOutcome, BadgeVariant> = {
  [TurnOutcome.Working]: "default",
  [TurnOutcome.WaitingForAgents]: "secondary",
  [TurnOutcome.WaitingForPeople]: "secondary",
  [TurnOutcome.Closed]: "success",
  [TurnOutcome.Done]: "success",
  [TurnOutcome.Failed]: "error",
  [TurnOutcome.Superseded]: "outline",
};

const TASK_STATUS_LABELS: Record<OrchestratorTaskStatus, string> = {
  [OrchestratorTaskStatus.Queued]: "Queued",
  [OrchestratorTaskStatus.Running]: "Running",
  [OrchestratorTaskStatus.Succeeded]: "Succeeded",
  [OrchestratorTaskStatus.Failed]: "Failed",
  [OrchestratorTaskStatus.Cancelled]: "Cancelled",
};

const TASK_STATUS_VARIANTS: Record<OrchestratorTaskStatus, BadgeVariant> = {
  [OrchestratorTaskStatus.Queued]: "secondary",
  [OrchestratorTaskStatus.Running]: "default",
  [OrchestratorTaskStatus.Succeeded]: "success",
  [OrchestratorTaskStatus.Failed]: "error",
  [OrchestratorTaskStatus.Cancelled]: "outline",
};

const MESSAGE_KIND_LABELS: Record<OrchestratorMessageKind, string> = {
  [OrchestratorMessageKind.Message]: "Message",
  [OrchestratorMessageKind.TaskResults]:
    "Task results (sent to the orchestrator)",
  [OrchestratorMessageKind.Decision]: "Decision",
  [OrchestratorMessageKind.Deadline]: "Deadline reached",
  [OrchestratorMessageKind.Reply]: "Reply",
  [OrchestratorMessageKind.StatusChanged]: "Status changed",
  [OrchestratorMessageKind.LabelAdded]: "Label added",
  [OrchestratorMessageKind.LabelRemoved]: "Label removed",
  [OrchestratorMessageKind.ToolRefused]: "Refused tool call",
  [OrchestratorMessageKind.Document]: "Document",
  [OrchestratorMessageKind.CaseNotify]: "Case notice",
  [OrchestratorMessageKind.Handoff]: "Change request",
  [OrchestratorMessageKind.HandoffSent]: "Handed off",
  [OrchestratorMessageKind.TaskAsked]: "Asked on item",
};
const CLAMP_CHARS = 600;
const SHORT_ID_CHARS = 8;
const REPLY_TO_EXCERPT_CHARS = 80;
const EMPTY_VALUE = "—";
const BYTES_PER_KB = 1024;
/** A single newline in a message is a line break, as in Jira or Slack. */
const REMARK_PLUGINS = [remarkBreaks];

export function OrchestratorConversationTimeline({
  caseId,
  conversation,
  caseMessages,
  tasks,
  isAdmin,
}: Readonly<{
  caseId: string;
  conversation: OrchestratorCaseConversation;
  /** Every message of the case, to find the message a task answers in another conversation. */
  caseMessages?: OrchestratorCaseMessage[];
  tasks: OrchestratorCaseTask[];
  isAdmin: boolean;
}>) {
  const answerable = caseMessages ?? conversation.messages;
  const timeline = buildConversationTimeline(conversation, tasks);

  return (
    <>
      {timeline.entries.map((entry) => (
        <TimelineEntry
          caseId={caseId}
          entry={entry}
          isAdmin={isAdmin}
          key={entryKey(entry)}
          messages={answerable}
          tasks={tasks}
        />
      ))}
      {timeline.unassignedTasks.length > 0 ? (
        <div className="space-y-2">
          <p className="font-medium text-sm">Other tasks</p>
          {timeline.unassignedTasks.map((task) => (
            <TaskRow
              caseId={caseId}
              key={task.id}
              messages={answerable}
              task={task}
              tasks={tasks}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function TimelineEntry({
  entry,
  caseId,
  isAdmin,
  tasks,
  messages,
}: Readonly<{
  entry: CaseTimelineEntry;
  caseId: string;
  isAdmin: boolean;
  tasks: OrchestratorCaseTask[];
  messages: OrchestratorCaseMessage[];
}>) {
  if (entry.kind === CaseTimelineEntryKind.Person) {
    return <PersonEntry line={entry.line} message={entry.message} />;
  }
  if (entry.kind === CaseTimelineEntryKind.Orchestrator) {
    return (
      <OrchestratorEntry
        at={entry.at}
        block={entry.block}
        caseId={caseId}
        isAdmin={isAdmin}
        messages={messages}
        tasks={tasks}
      />
    );
  }
  return <AgentEntry at={entry.at} caseId={caseId} task={entry.task} />;
}

function PersonEntry({
  message,
  line,
}: Readonly<{ message: OrchestratorCaseMessage; line: string }>) {
  return (
    <div
      className="space-y-1 rounded-md bg-muted/40 p-3"
      data-testid="case-timeline-person"
    >
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span className="font-medium text-foreground">
          {personName(message)}
        </span>
        <span>{line}</span>
        <span>{formatDateTime(message.createdAt)}</span>
      </div>
      {message.kind === OrchestratorMessageKind.Message ? (
        <ClampedText text={message.text} />
      ) : null}
    </div>
  );
}

function OrchestratorEntry({
  block,
  at,
  tasks,
  messages,
  caseId,
  isAdmin,
}: Readonly<{
  block: OrchestratorBlock;
  at: string;
  tasks: OrchestratorCaseTask[];
  messages: OrchestratorCaseMessage[];
  caseId: string;
  isAdmin: boolean;
}>) {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="case-timeline-orchestrator"
    >
      <OrchestratorHeader
        at={at}
        block={block}
        caseId={caseId}
        isAdmin={isAdmin}
      />
      <OrchestratorBody block={block} />
      {block.tasks.map((task) => (
        <SentToAgent
          key={task.id}
          messages={messages}
          task={task}
          tasks={tasks}
        />
      ))}
      <TurnDetails block={block} />
    </div>
  );
}

function OrchestratorHeader({
  block,
  at,
  caseId,
  isAdmin,
}: Readonly<{
  block: OrchestratorBlock;
  at: string;
  caseId: string;
  isAdmin: boolean;
}>) {
  const turn = block.turn;
  if (!turn) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Orchestrator</span>
        <span className="text-muted-foreground">{formatDateTime(at)}</span>
      </div>
    );
  }
  const outcome = turnOutcome(turn);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">Orchestrator</span>
      <Badge variant={TURN_OUTCOME_VARIANTS[outcome]}>
        {TURN_OUTCOME_LABELS[outcome]}
      </Badge>
      <span className="text-muted-foreground">
        {formatDateTime(turn.startedAt)}
      </span>
      {turn.runnerName ? (
        <span className="text-muted-foreground">on {turn.runnerName}</span>
      ) : null}
      <span className="text-muted-foreground">{turnDuration(turn)}</span>
      <span className="text-muted-foreground">{usageText(turn)}</span>
      {turn.status === OrchestratorTurnStatus.Running && isAdmin ? (
        <StopTurnControl caseId={caseId} turnId={turn.id} />
      ) : null}
    </div>
  );
}

function StopTurnControl({
  caseId,
  turnId,
}: Readonly<{ caseId: string; turnId: string }>) {
  const cancel = useCancelOrchestratorTurn(caseId);
  const [confirmStop, setConfirmStop] = useState(false);

  return (
    <>
      <Button
        disabled={cancel.isPending}
        onClick={() => setConfirmStop(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        Stop turn
      </Button>
      <ConfirmationDialog
        confirmLabel="Stop turn"
        description="The runner is asked to stop this turn. Its messages are not retried."
        isPending={cancel.isPending}
        onConfirm={async () => {
          await cancel.mutateAsync(turnId);
        }}
        onOpenChange={setConfirmStop}
        open={confirmStop}
        title="Stop this turn?"
        variant="destructive"
      />
    </>
  );
}

function OrchestratorBody({ block }: Readonly<{ block: OrchestratorBlock }>) {
  const summary = block.turn?.summary;

  return (
    <>
      {block.replies.map((reply) => (
        <div className="space-y-1" key={reply.id}>
          <p className="text-muted-foreground text-xs">{replyLabel(reply)}</p>
          <ClampedText text={reply.text} />
        </div>
      ))}
      {block.replies.length === 0 && summary ? (
        <ClampedText text={summary} />
      ) : null}
      {block.notices.map((notice) => (
        <p className="text-muted-foreground text-xs" key={notice.id}>
          {noticeLine(notice)}
        </p>
      ))}
      {block.refusals.map((refusal) => (
        <p className="text-destructive text-xs" key={refusal.id}>
          Refused: {refusal.text}
        </p>
      ))}
      {block.notes.map((note) => (
        <p className="text-muted-foreground text-xs" key={note.id}>
          {stripActorSuffix(note.text, note.actor)}
        </p>
      ))}
    </>
  );
}

function SentToAgent({
  task,
  tasks,
  messages,
}: Readonly<{
  task: OrchestratorCaseTask;
  tasks: OrchestratorCaseTask[];
  messages: OrchestratorCaseMessage[];
}>) {
  const buildOrgPath = useOrgPath();

  return (
    <div
      className="space-y-1 rounded-md border bg-muted/30 p-2 text-sm"
      data-testid="case-timeline-sent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Sent to {agentName(task)}</span>
        <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
        {task.waiting ? (
          <span className="text-muted-foreground text-xs">{task.waiting}</span>
        ) : null}
        {task.loopId ? (
          <Link
            className="text-primary hover:underline"
            href={buildOrgPath(`/loops/${task.loopId}`)}
          >
            Open loop
          </Link>
        ) : null}
      </div>
      <TaskSentContent messages={messages} task={task} tasks={tasks} />
    </div>
  );
}

function TaskSentContent({
  task,
  tasks,
  messages,
}: Readonly<{
  task: OrchestratorCaseTask;
  tasks: OrchestratorCaseTask[];
  messages: OrchestratorCaseMessage[];
}>) {
  return (
    <dl className="space-y-1 text-xs">
      <SentRow label="Command">
        <code>
          {task.command} {task.args}
        </code>
      </SentRow>
      <SentRow label="Mode">{task.mode}</SentRow>
      {task.resumeTaskId ? (
        <SentRow label="Session">
          <TaskForkNote task={task} />
        </SentRow>
      ) : null}
      {task.inputs.length > 0 ? (
        <SentRow label="Input files">
          <ul className="space-y-0.5">
            {task.inputs.map((input) => (
              <TaskInputLine
                input={input}
                key={`${input.fromTaskId ?? "page"}-${input.name}`}
                tasks={tasks}
              />
            ))}
          </ul>
        </SentRow>
      ) : null}
      <ReplyToLine messages={messages} task={task} />
      {task.prompt ? (
        <SentRow label="Prompt">
          <ClampedText text={task.prompt} />
        </SentRow>
      ) : null}
    </dl>
  );
}

function SentRow({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function TaskInputLine({
  input,
  tasks,
}: Readonly<{
  input: OrchestratorCaseTaskInput;
  tasks: OrchestratorCaseTask[];
}>) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{input.name}</span>
      <span className="text-muted-foreground">
        {formatFileSize(input.size)}
      </span>
      <InputOrigin input={input} tasks={tasks} />
    </li>
  );
}

function InputOrigin({
  input,
  tasks,
}: Readonly<{
  input: OrchestratorCaseTaskInput;
  tasks: OrchestratorCaseTask[];
}>) {
  if (input.page) {
    const { title, url, version } = input.page;
    return (
      <span className="text-muted-foreground">
        Confluence page{" "}
        {isHttpUrl(url) ? (
          <a
            className="text-primary hover:underline"
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            {title}
          </a>
        ) : (
          title
        )}{" "}
        v{version}
      </span>
    );
  }
  if (input.fromTaskId) {
    return (
      <span className="text-muted-foreground">
        {inputOriginText(input.fromTaskId, tasks)}
      </span>
    );
  }
  return null;
}

function ReplyToLine({
  task,
  messages,
}: Readonly<{
  task: OrchestratorCaseTask;
  messages: OrchestratorCaseMessage[];
}>) {
  const answered = task.replyToMessageId
    ? messages.find((message) => message.id === task.replyToMessageId)
    : undefined;
  if (answered) {
    return (
      <SentRow label="Answers">
        {personName(answered)}: {excerpt(answered.text)}
      </SentRow>
    );
  }
  if (task.replyTo) {
    return <SentRow label="Answers">message {task.replyTo}</SentRow>;
  }
  return null;
}

function TurnDetails({ block }: Readonly<{ block: OrchestratorBlock }>) {
  const summary = block.replies.length > 0 ? block.turn?.summary : null;
  const error = block.turn?.error;
  if (block.inputs.length === 0 && !summary && !error) {
    return null;
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground text-xs">
        Details
      </summary>
      <div className="mt-2 space-y-2">
        {block.inputs.map((input) => (
          <div className="space-y-1" key={input.id}>
            <p className="text-muted-foreground text-xs">
              {MESSAGE_KIND_LABELS[input.kind]} ·{" "}
              {formatDateTime(input.createdAt)}
            </p>
            <ClampedText text={input.text} />
          </div>
        ))}
        {summary ? <ClampedText text={summary} /> : null}
        {error ? (
          <p className="whitespace-pre-wrap text-destructive">{error}</p>
        ) : null}
      </div>
    </details>
  );
}

function AgentEntry({
  task,
  at,
  caseId,
}: Readonly<{ task: OrchestratorCaseTask; at: string; caseId: string }>) {
  return (
    <div
      className="space-y-1 rounded-md bg-muted/30 p-3 text-sm"
      data-testid="case-timeline-agent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{agentName(task)}</span>
        <code className="text-xs">
          {task.command} {task.args}
        </code>
        <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {formatDateTime(at)}
        </span>
      </div>
      <TaskOutcome caseId={caseId} task={task} />
    </div>
  );
}

function TaskRow({
  task,
  tasks,
  messages,
  caseId,
}: Readonly<{
  task: OrchestratorCaseTask;
  tasks: OrchestratorCaseTask[];
  messages: OrchestratorCaseMessage[];
  caseId: string;
}>) {
  const buildOrgPath = useOrgPath();

  return (
    <div className="space-y-1 rounded-md bg-muted/30 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TASK_STATUS_VARIANTS[task.status]}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
        {task.runnerName ? (
          <span className="text-muted-foreground">on {task.runnerName}</span>
        ) : null}
        {task.waiting ? (
          <span className="text-muted-foreground text-xs">{task.waiting}</span>
        ) : null}
        {task.loopId ? (
          <Link
            className="text-primary hover:underline"
            href={buildOrgPath(`/loops/${task.loopId}`)}
          >
            Open loop
          </Link>
        ) : null}
      </div>
      <TaskSentContent messages={messages} task={task} tasks={tasks} />
      <TaskOutcome caseId={caseId} task={task} />
    </div>
  );
}

function TaskOutcome({
  task,
  caseId,
}: Readonly<{ task: OrchestratorCaseTask; caseId: string }>) {
  const isPending = task.openQuestionCount > 0;

  return (
    <>
      {task.reply ? <ClampedText text={task.reply} /> : null}
      <TaskFiles task={task} />
      {isPending ? (
        <TaskQuestionsForm caseId={caseId} key={task.id} task={task} />
      ) : null}
      {task.questions.length > 0 && !isPending ? (
        <ul className="list-disc pl-5">
          {task.questions.map((question) => (
            <li key={question.id}>{question.question}</li>
          ))}
        </ul>
      ) : null}
      {task.error ? (
        <p className="whitespace-pre-wrap text-destructive">{task.error}</p>
      ) : null}
    </>
  );
}

function TaskForkNote({ task }: Readonly<{ task: OrchestratorCaseTask }>) {
  if (!task.resumeTaskId) {
    return null;
  }
  return (
    <span className="text-muted-foreground">
      {task.fork ? "forks" : "resumes"} task{" "}
      {task.resumeTaskId.slice(0, SHORT_ID_CHARS)}
    </span>
  );
}

export function ClampedText({ text }: Readonly<{ text: string }>) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > CLAMP_CHARS;
  const shown = isLong && !expanded ? `${text.slice(0, CLAMP_CHARS)}…` : text;

  return (
    <div>
      <MarkdownContent
        className="break-words"
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        text={shown}
      />
      {isLong ? (
        <Button
          onClick={() => setExpanded(!expanded)}
          size="sm"
          type="button"
          variant="link"
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function replyLabel(reply: OrchestratorCaseMessage): string {
  return reply.via === OrchestratorMessageVia.AgentFlow
    ? "Reply on the case page"
    : "Reply on the ticket thread";
}

function noticeLine(notice: OrchestratorCaseMessage): string {
  const actor = notice.actor ?? "someone";
  return notice.kind === OrchestratorMessageKind.Handoff
    ? `Change request approved by ${actor}`
    : `Notice from ${actor}`;
}

function inputOriginText(
  fromTaskId: string,
  tasks: OrchestratorCaseTask[]
): string {
  const source = tasks.find((task) => task.id === fromTaskId);
  const shortId = fromTaskId.slice(0, SHORT_ID_CHARS);
  if (!source) {
    return `from task ${shortId}`;
  }
  return `from ${agentName(source)} task ${shortId}`;
}

function excerpt(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  if (firstLine.length <= REPLY_TO_EXCERPT_CHARS) {
    return firstLine;
  }
  return `${firstLine.slice(0, REPLY_TO_EXCERPT_CHARS)}…`;
}

function turnDuration(turn: OrchestratorCaseTurn): string {
  if (!turn.finishedAt) {
    return EMPTY_VALUE;
  }
  const ms =
    new Date(turn.finishedAt).getTime() - new Date(turn.startedAt).getTime();
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Unknown usage is shown as a dash, never as zero tokens or $0.00. */
function usageText(turn: OrchestratorCaseTurn): string {
  const usage = turn.usage;
  if (!usage) {
    return EMPTY_VALUE;
  }
  const parts: string[] = [];
  if (usage.inputTokens !== null) {
    parts.push(`${formatTokenCount(usage.inputTokens)} in`);
  }
  if (usage.outputTokens !== null) {
    parts.push(`${formatTokenCount(usage.outputTokens)} out`);
  }
  if (usage.costUsd !== null) {
    parts.push(formatCostPrecise(usage.costUsd));
  }
  return parts.length > 0 ? parts.join(" · ") : EMPTY_VALUE;
}

function TaskFiles({ task }: Readonly<{ task: OrchestratorCaseTask }>) {
  if (task.files.length === 0 && task.filesOmitted === 0) {
    return null;
  }
  return (
    <ul className="space-y-0.5" data-testid="orchestrator-task-files">
      {task.files.map((file) => (
        <li className="flex flex-wrap items-center gap-2" key={file.name}>
          <span className="font-mono text-xs">{file.name}</span>
          <span className="text-muted-foreground text-xs">
            {formatFileSize(file.size)}
          </span>
          {file.stored ? null : (
            <span className="text-muted-foreground text-xs">
              {file.skipped ?? "not stored"}
            </span>
          )}
        </li>
      ))}
      {task.filesOmitted > 0 ? (
        <li className="text-muted-foreground text-xs">
          +{task.filesOmitted} more not collected
        </li>
      ) : null}
    </ul>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < BYTES_PER_KB) {
    return `${bytes} B`;
  }
  if (bytes < BYTES_PER_KB * BYTES_PER_KB) {
    return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  }
  return `${(bytes / (BYTES_PER_KB * BYTES_PER_KB)).toFixed(1)} MB`;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
