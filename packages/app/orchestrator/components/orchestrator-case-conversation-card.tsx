"use client";

import type {
  OrchestratorCaseConversation,
  OrchestratorCaseTask,
  OrchestratorCaseWait,
} from "@repo/api/src/types/orchestrator";
import { formatDateTime } from "@repo/app/shared/lib/date-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { ConversationMessageForm } from "./conversation-message-form";
import { OrchestratorConversationTimeline } from "./orchestrator-case-timeline";

const SHORT_ID_CHARS = 8;
const EMPTY_VALUE = "—";

export function OrchestratorCaseConversationCard({
  caseId,
  conversation,
  tasks,
  isAdmin,
}: Readonly<{
  caseId: string;
  conversation: OrchestratorCaseConversation;
  tasks: OrchestratorCaseTask[];
  isAdmin: boolean;
}>) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{conversation.channelKey}</CardTitle>
        <Badge variant="outline">{conversation.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <OrchestratorConversationTimeline
          caseId={caseId}
          conversation={conversation}
          isAdmin={isAdmin}
          tasks={tasks}
        />
        <ConversationMessageForm
          caseId={caseId}
          conversationId={conversation.id}
          key={conversation.id}
        />
      </CardContent>
    </Card>
  );
}

export function OrchestratorCaseWaitsCard({
  waits,
}: Readonly<{ waits: OrchestratorCaseWait[] }>) {
  if (waits.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Waits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {waits.map((wait) => (
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            key={wait.id}
          >
            <Badge variant={wait.firedAt ? "outline" : "default"}>
              {wait.firedAt ? "Fired" : "Open"}
            </Badge>
            <span>{wait.kind}</span>
            <span className="text-muted-foreground">
              {wait.taskIds
                .map((id) => id.slice(0, SHORT_ID_CHARS))
                .join(", ") || EMPTY_VALUE}
            </span>
            {wait.deadline ? (
              <span className="text-muted-foreground">
                deadline {formatDateTime(wait.deadline)}
              </span>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
