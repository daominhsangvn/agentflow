"use client";

import { useChat } from "@ai-sdk/react";
import {
  WorkflowBuilderErrorCode,
  WorkflowBuilderToolName,
} from "@repo/api/src/types/workflow-builder";
import {
  type ProposeWorkflowOutput,
  proposeWorkflowInputSchema,
} from "@repo/api/src/types/workflow-builder-schemas";
import { useAuthSnapshot } from "@repo/app/shared/auth/use-auth-snapshot";
import type { WorkflowEditorAssistantContext } from "@repo/app/workflows/components/workflow-editor";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import { Button } from "@repo/design-system/components/ui/button";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import {
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearStoredMessages,
  loadStoredMessages,
  saveStoredMessages,
  workflowBuilderStorageKey,
} from "@/lib/workflow-builder/chat-storage";
import { useWorkflowBuilderTransport } from "@/lib/workflow-builder/use-workflow-builder-transport";
import { WorkflowBuilderProposalCard } from "./workflow-builder-proposal-card";

/** After this many invalid proposals in a row the client stops answering the agent on its own. */
const MAX_INVALID_STREAK = 3;
/**
 * Hard cap on sends the client makes on its own after one user message (tool-result round
 * trips, continuation after the server step cap, valid and invalid proposals alike).
 */
export const MAX_AUTO_SENDS_PER_TURN = 5;
const PROPOSE_PART_TYPE = `tool-${WorkflowBuilderToolName.ProposeWorkflow}`;
const NOT_CONFIGURED_MESSAGE = "The assistant is not configured";
const RATE_LIMITED_MESSAGE = "Too many requests, try again in a minute";
/** What the "Guide me" button sends: the agent answers with its bundled opening questions. */
const GUIDE_ME_MESSAGE =
  "Guide me step by step: ask me what you need to know to build this workflow.";
const AUTO_SEND_LIMIT_NOTICE =
  "The assistant stopped after several automatic steps. Send a message to continue.";

const TOOL_LABELS: Record<string, string> = {
  [`tool-${WorkflowBuilderToolName.ListGuides}`]: "Read the guides",
  [`tool-${WorkflowBuilderToolName.ReadGuide}`]: "Read the guides",
  [`tool-${WorkflowBuilderToolName.GetCatalog}`]: "Looked up the organization",
};

type AppliedProposal = { toolCallId: string; previousText: string };

type WorkflowBuilderChatPanelProps = {
  context: WorkflowEditorAssistantContext;
};

/** Loads the stored chat for this organization and workflow, then mounts the chat. */
export default function WorkflowBuilderChatPanel({
  context,
}: Readonly<WorkflowBuilderChatPanelProps>) {
  const { orgId } = useAuthSnapshot();
  const storageKey = orgId
    ? workflowBuilderStorageKey(orgId, context.workflowId)
    : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    messages: UIMessage[];
  } | null>(null);

  useEffect(() => {
    if (!storageKey) {
      return;
    }
    let cancelled = false;
    loadStoredMessages(storageKey).then((messages) => {
      if (!cancelled) {
        setLoaded({ key: storageKey, messages });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (!storageKey || loaded?.key !== storageKey) {
    return <p className="p-4 text-muted-foreground text-sm">Loading...</p>;
  }

  return (
    <WorkflowBuilderChat
      context={context}
      initialMessages={loaded.messages}
      key={storageKey}
      storageKey={storageKey}
    />
  );
}

function WorkflowBuilderChat({
  context,
  initialMessages,
  storageKey,
}: Readonly<{
  context: WorkflowEditorAssistantContext;
  initialMessages: UIMessage[];
  storageKey: string;
}>) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const invalidStreakRef = useRef(0);
  const autoSendCountRef = useRef(0);
  const [autoSendLimitHit, setAutoSendLimitHit] = useState(false);
  const [applied, setApplied] = useState<AppliedProposal | null>(null);
  const [draft, setDraft] = useState("");
  const getEditorYaml = useCallback(() => contextRef.current.text, []);
  const transport = useWorkflowBuilderTransport({
    workflowId: context.workflowId,
    getEditorYaml,
  });

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    addToolOutput,
  } = useChat({
    id: storageKey,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: (options) => {
      if (
        !lastAssistantMessageIsCompleteWithToolCalls(options) ||
        invalidStreakRef.current >= MAX_INVALID_STREAK
      ) {
        return false;
      }
      if (autoSendCountRef.current >= MAX_AUTO_SENDS_PER_TURN) {
        setAutoSendLimitHit(true);
        return false;
      }
      autoSendCountRef.current += 1;
      return true;
    },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName !== WorkflowBuilderToolName.ProposeWorkflow) {
        return;
      }
      const output = checkProposal(toolCall.input, contextRef.current);
      invalidStreakRef.current = output.valid
        ? 0
        : invalidStreakRef.current + 1;
      addToolOutput({
        tool: WorkflowBuilderToolName.ProposeWorkflow,
        toolCallId: toolCall.toolCallId,
        output,
      });
    },
    onFinish: ({ messages: finished }) => {
      saveStoredMessages(storageKey, finished);
    },
  });

  const isBusy = status === "streaming" || status === "submitted";

  function send(text: string) {
    invalidStreakRef.current = 0;
    autoSendCountRef.current = 0;
    setAutoSendLimitHit(false);
    sendMessage({ text });
  }

  function submitDraft() {
    const text = draft.trim();
    if (!text || isBusy) {
      return;
    }
    setDraft("");
    send(text);
  }

  /** Starts a new conversation; the editor text stays as it is. */
  function startNewChat() {
    stop();
    invalidStreakRef.current = 0;
    autoSendCountRef.current = 0;
    setAutoSendLimitHit(false);
    setMessages([]);
    setApplied(null);
    clearStoredMessages(storageKey);
  }

  function applyProposal(toolCallId: string, yaml: string) {
    setApplied({ toolCallId, previousText: context.text });
    context.setText(yaml);
  }

  function revertProposal() {
    if (applied) {
      context.setText(applied.previousText);
      setApplied(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && !isBusy ? (
          <div
            className="space-y-2 rounded-md border border-dashed p-3 text-sm"
            data-testid="workflow-builder-welcome"
          >
            <p>
              Describe the workflow you want, or let the assistant ask you a few
              questions about where it starts, what the agent team does and what
              happens afterwards.
            </p>
            <Button
              onClick={() => send(GUIDE_ME_MESSAGE)}
              size="sm"
              type="button"
              variant="outline"
            >
              Guide me
            </Button>
          </div>
        ) : null}
        {messages.map((message) => (
          <div
            className={message.role === "user" ? "text-right" : "text-left"}
            key={message.id}
          >
            {message.parts.map((part, index) => {
              if (part.type === "text") {
                return (
                  <p
                    className="whitespace-pre-wrap text-sm"
                    key={textPartKey(message.id, index)}
                  >
                    {part.text}
                  </p>
                );
              }
              if (!isToolUIPart(part)) {
                return null;
              }
              if (part.type === PROPOSE_PART_TYPE) {
                return (
                  <ProposalPart
                    applied={applied}
                    context={context}
                    key={part.toolCallId}
                    onApply={applyProposal}
                    onAskFix={(problems) =>
                      send(`Fix these problems:\n${problems}`)
                    }
                    onRevert={revertProposal}
                    part={part}
                  />
                );
              }
              return (
                <p
                  className="text-muted-foreground text-xs"
                  key={part.toolCallId}
                >
                  {TOOL_LABELS[part.type] ?? "Working"}
                </p>
              );
            })}
          </div>
        ))}
      </div>
      {autoSendLimitHit ? (
        <Alert>
          <AlertDescription>{AUTO_SEND_LIMIT_NOTICE}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      ) : null}
      <Textarea
        aria-label="Message to the assistant"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitDraft();
          }
        }}
        placeholder="Describe the workflow you want"
        rows={3}
        value={draft}
      />
      <div className="flex items-center gap-2">
        {status === "streaming" ? (
          <Button onClick={() => stop()} size="sm" type="button">
            Stop
          </Button>
        ) : (
          <Button
            disabled={isBusy || draft.trim() === ""}
            onClick={submitDraft}
            size="sm"
            type="button"
          >
            Send
          </Button>
        )}
        <Button
          disabled={messages.length === 0}
          onClick={startNewChat}
          size="sm"
          type="button"
          variant="ghost"
        >
          New chat
        </Button>
      </div>
    </div>
  );
}

type ProposalToolPart = {
  toolCallId: string;
  input?: unknown;
  output?: unknown;
  state: string;
};

function ProposalPart({
  part,
  context,
  applied,
  onApply,
  onRevert,
  onAskFix,
}: Readonly<{
  part: ProposalToolPart;
  context: WorkflowEditorAssistantContext;
  applied: AppliedProposal | null;
  onApply: (toolCallId: string, yaml: string) => void;
  onRevert: () => void;
  onAskFix: (problems: string) => void;
}>) {
  const proposal = proposeWorkflowInputSchema.safeParse(part.input);
  if (!proposal.success) {
    return null;
  }
  const result =
    part.state === "output-available"
      ? (part.output as ProposeWorkflowOutput)
      : null;
  const isApplied = applied?.toolCallId === part.toolCallId;

  return (
    <WorkflowBuilderProposalCard
      canRevert={isApplied}
      currentText={context.text}
      isApplied={isApplied}
      onApply={() => onApply(part.toolCallId, proposal.data.yaml)}
      onAskFix={() => onAskFix(formatProblems(result))}
      onRevert={onRevert}
      proposal={proposal.data}
      result={result}
    />
  );
}

function checkProposal(
  input: unknown,
  context: WorkflowEditorAssistantContext
): ProposeWorkflowOutput {
  const parsed = proposeWorkflowInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      problems: [
        {
          line: 0,
          message: "propose_workflow needs a yaml string",
          isError: true,
        },
      ],
    };
  }
  return context.validate(parsed.data.yaml);
}

function formatProblems(result: ProposeWorkflowOutput | null): string {
  return (result?.problems ?? [])
    .map((problem) => `Line ${problem.line}: ${problem.message}`)
    .join("\n");
}

function describeError(error: Error): string {
  if (error.message.includes(WorkflowBuilderErrorCode.NotConfigured)) {
    return NOT_CONFIGURED_MESSAGE;
  }
  if (error.message.includes(WorkflowBuilderErrorCode.RateLimited)) {
    return RATE_LIMITED_MESSAGE;
  }
  return error.message || "The assistant could not answer. Try again.";
}

// Text parts have no id and never reorder within a message.
function textPartKey(messageId: string, position: number): string {
  return `${messageId}-text-${position}`;
}
