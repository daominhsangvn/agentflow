import { MarkdownContent } from "@repo/design-system/components/ui/primitives/markdown-content";

const BUBBLE_BASE =
  "max-w-[85%] rounded-2xl px-3 py-2 text-left text-sm break-words [overflow-wrap:anywhere]";

/** One chat bubble: user text on the right (plain), assistant text on the left (markdown). */
export function WorkflowBuilderTextBubble({
  role,
  text,
}: Readonly<{ role: WorkflowBuilderBubbleRole; text: string }>) {
  if (role === WorkflowBuilderBubbleRole.User) {
    return (
      <div
        className="flex w-full justify-end"
        data-role={role}
        data-testid="workflow-builder-message"
      >
        <div
          className={`${BUBBLE_BASE} rounded-br-sm bg-primary text-primary-foreground`}
        >
          <p className="whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex w-full justify-start"
      data-role={role}
      data-testid="workflow-builder-message"
    >
      <div className={`${BUBBLE_BASE} rounded-bl-sm bg-muted text-foreground`}>
        <MarkdownContent className="text-left" dense skipHtml text={text} />
      </div>
    </div>
  );
}

export function WorkflowBuilderThinking() {
  return (
    <p
      aria-live="polite"
      className="animate-pulse self-start text-left text-muted-foreground text-xs"
      data-testid="workflow-builder-thinking"
      role="status"
    >
      Thinking...
    </p>
  );
}

export const WorkflowBuilderBubbleRole = {
  User: "user",
  Assistant: "assistant",
} as const;
export type WorkflowBuilderBubbleRole =
  (typeof WorkflowBuilderBubbleRole)[keyof typeof WorkflowBuilderBubbleRole];
