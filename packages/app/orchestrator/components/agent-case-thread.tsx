"use client";

import type {
  OrchestratorCaseConversation,
  OrchestratorCaseDetail,
} from "@repo/api/src/types/orchestrator";
// Cross-slice: retryable error block.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { formatRelativeTime } from "@repo/app/shared/lib/date-utils";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { Link } from "@repo/navigation/link";
import { useOrgPath } from "@repo/navigation/use-org-path";
import { useState } from "react";
import { useOrchestratorCase } from "../hooks/use-orchestrator-cases";
import { ORCHESTRATOR_NODE_ID } from "../lib/agent-counters";
import {
  type AgentTimelineEntry,
  AgentTimelineEntryKind,
  buildAgentTimeline,
} from "../lib/agent-timeline";
import { ConversationMessageForm } from "./conversation-message-form";
import { OrchestratorCaseDecisionsCard } from "./orchestrator-case-decisions-card";
import {
  ClampedText,
  OrchestratorConversationTimeline,
} from "./orchestrator-case-timeline";
import { TaskQuestionsForm } from "./task-questions-form";

export type AgentCaseThreadProps = {
  caseId: string;
  /** id is "orchestrator" or a compute target id. */
  node: { id: string; name: string };
  isAdmin: boolean;
  onBack: () => void;
};

export function AgentCaseThread({
  caseId,
  node,
  isAdmin,
  onBack,
}: Readonly<AgentCaseThreadProps>) {
  const query = useOrchestratorCase(caseId);
  const buildOrgPath = useOrgPath();
  const detail = query.data;

  return (
    <div className="flex flex-col gap-3" data-testid="agent-case-thread">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button onClick={onBack} size="sm" type="button" variant="ghost">
          ← Cases
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm">
          {detail?.sourceKey ? (
            <span className="font-mono">{detail.sourceKey}</span>
          ) : null}
          {detail?.sourceKey ? " · " : ""}
          {node.name}
        </span>
        <Link
          className="text-primary text-sm hover:underline"
          href={buildOrgPath(`/orchestrator/cases/${caseId}`)}
        >
          Open
        </Link>
      </div>
      {query.isLoading ? (
        <div aria-label="Loading case" className="space-y-3" role="status">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}
      {!query.isLoading && (query.error || !detail) ? (
        <QueryErrorMessage
          error={query.error}
          onRetry={() => {
            query.refetch();
          }}
          title="Couldn't load the case"
        />
      ) : null}
      {detail && node.id === ORCHESTRATOR_NODE_ID ? (
        <OrchestratorThread detail={detail} isAdmin={isAdmin} />
      ) : null}
      {detail && node.id !== ORCHESTRATOR_NODE_ID ? (
        <AgentThread detail={detail} node={node} />
      ) : null}
    </div>
  );
}

function OrchestratorThread({
  detail,
  isAdmin,
}: Readonly<{ detail: OrchestratorCaseDetail; isAdmin: boolean }>) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const conversations = detail.conversations;
  const chosen =
    conversations.find((conversation) => conversation.id === pickedId) ??
    newestConversation(conversations);

  return (
    <div className="flex flex-col gap-3">
      <OrchestratorCaseDecisionsCard
        caseId={detail.id}
        decisions={detail.decisions}
        isAdmin={isAdmin}
      />
      {conversations.length > 1 && chosen ? (
        <Select onValueChange={setPickedId} value={chosen.id}>
          <SelectTrigger aria-label="Conversation">
            <SelectValue placeholder="Conversation" />
          </SelectTrigger>
          <SelectContent>
            {conversations.map((conversation) => (
              <SelectItem key={conversation.id} value={conversation.id}>
                {conversation.channelKey}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {chosen ? (
        <>
          <OrchestratorConversationTimeline
            caseId={detail.id}
            conversation={chosen}
            isAdmin={isAdmin}
            tasks={detail.tasks}
          />
          <ConversationMessageForm
            caseId={detail.id}
            conversationId={chosen.id}
            key={chosen.id}
          />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">No conversation yet.</p>
      )}
    </div>
  );
}

function AgentThread({
  detail,
  node,
}: Readonly<{
  detail: OrchestratorCaseDetail;
  node: { id: string; name: string };
}>) {
  const timeline = buildAgentTimeline(detail, node.id);

  return (
    <div className="flex flex-col gap-3">
      {timeline.openQuestionTasks.map((task) => (
        <TaskQuestionsForm
          caseId={detail.id}
          key={task.id}
          task={task}
          title={`${node.name} asks (${task.openQuestionCount})`}
        />
      ))}
      {timeline.entries.map((entry) => (
        <AgentEntryRow entry={entry} key={entry.id} name={node.name} />
      ))}
      <AgentComposer
        caseId={detail.id}
        conversationId={timeline.conversationId}
        hasOpenQuestions={timeline.openQuestionTasks.length > 0}
        node={node}
        sourceKey={detail.sourceKey ?? "this case"}
      />
    </div>
  );
}

function AgentComposer({
  caseId,
  conversationId,
  hasOpenQuestions,
  node,
  sourceKey,
}: Readonly<{
  caseId: string;
  conversationId: string | null | undefined;
  hasOpenQuestions: boolean;
  node: { id: string; name: string };
  sourceKey: string;
}>) {
  if (!conversationId) {
    return (
      <p className="text-muted-foreground text-sm">
        {node.name} has no task in this case yet.
      </p>
    );
  }
  if (hasOpenQuestions) {
    return (
      <p
        className="border-t pt-3 text-muted-foreground text-sm"
        data-testid="agent-ask-locked"
      >
        Answer {node.name}'s questions above. You can ask {node.name} about{" "}
        {sourceKey} once they are answered: a question now would go to a
        read-only copy of its task and leave these questions open.
      </p>
    );
  }
  return (
    <ConversationMessageForm
      caseId={caseId}
      conversationId={conversationId}
      key={conversationId}
      label={`Ask ${node.name} about ${sourceKey}`}
      toAgentId={node.id}
    />
  );
}

function AgentEntryRow({
  entry,
  name,
}: Readonly<{ entry: AgentTimelineEntry; name: string }>) {
  return (
    <div className="space-y-1 rounded-md bg-muted/30 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span className="font-medium text-foreground">
          {entryTitle(entry, name)}
        </span>
        <span>{formatRelativeTime(entry.at)}</span>
      </div>
      <AgentEntryBody entry={entry} />
    </div>
  );
}

function AgentEntryBody({ entry }: Readonly<{ entry: AgentTimelineEntry }>) {
  if (entry.kind === AgentTimelineEntryKind.ToAgent) {
    return (
      <>
        <code className="text-xs">
          {entry.task.command} {entry.task.args}
        </code>
        {entry.task.prompt ? <ClampedText text={entry.task.prompt} /> : null}
      </>
    );
  }
  if (entry.kind === AgentTimelineEntryKind.FromAgent) {
    const { task } = entry;
    return (
      <>
        {task.reply ? <ClampedText text={task.reply} /> : null}
        {task.files.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {task.files.map((file) => file.name).join(", ")}
          </p>
        ) : null}
        {task.questions.length > 0 ? (
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
  return <ClampedText text={entry.message.text} />;
}

function entryTitle(entry: AgentTimelineEntry, name: string): string {
  if (entry.kind === AgentTimelineEntryKind.ToAgent) {
    return `Orchestrator → ${name}`;
  }
  if (entry.kind === AgentTimelineEntryKind.FromAgent) {
    return `${name} → Orchestrator`;
  }
  if (entry.kind === AgentTimelineEntryKind.AskedByPerson) {
    return `${entry.message.actor ?? "Someone"} → ${name}`;
  }
  return "Answer";
}

function newestConversation(
  conversations: OrchestratorCaseConversation[]
): OrchestratorCaseConversation | undefined {
  let best: OrchestratorCaseConversation | undefined;
  let bestAt = "";
  for (const conversation of conversations) {
    const times = [
      conversation.createdAt,
      ...conversation.messages.map((message) => message.createdAt),
      ...conversation.turns.map((turn) => turn.startedAt),
    ];
    const latest = times.reduce((a, b) => (a > b ? a : b));
    if (!best || latest > bestAt) {
      best = conversation;
      bestAt = latest;
    }
  }
  return best;
}
