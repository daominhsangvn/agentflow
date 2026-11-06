"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Label } from "@repo/design-system/components/ui/label";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import { usePostOrchestratorCaseMessage } from "../hooks/use-orchestrator-cases";

const DEFAULT_LABEL = "Message the orchestrator";
const DEFAULT_SUBMIT_LABEL = "Send";

export function ConversationMessageForm({
  caseId,
  conversationId,
  toAgentId,
  label = DEFAULT_LABEL,
  placeholder,
  submitLabel = DEFAULT_SUBMIT_LABEL,
}: Readonly<{
  caseId: string;
  conversationId: string;
  toAgentId?: string;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
}>) {
  const post = usePostOrchestratorCaseMessage(caseId);
  const [text, setText] = useState("");
  const trimmed = text.trim();

  const submit = async () => {
    try {
      await post.mutateAsync({
        conversationId,
        text: trimmed,
        ...(toAgentId ? { toAgentId } : {}),
      });
      setText("");
    } catch {
      // The global mutation handler toasts the error; keep the typed text.
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <Label htmlFor={`message-${conversationId}`}>{label}</Label>
      <Textarea
        id={`message-${conversationId}`}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        value={text}
      />
      <Button
        disabled={trimmed.length === 0 || post.isPending}
        onClick={submit}
        size="sm"
        type="button"
      >
        {submitLabel}
      </Button>
    </div>
  );
}
