"use client";

import type { WorkflowEditorAssistantContext } from "@repo/app/workflows/components/workflow-editor";
import { useWorkflowBuilderStatus } from "@repo/app/workflows/hooks/use-workflow-builder-status";
import { Button } from "@repo/design-system/components/ui/button";
import { cn } from "@repo/design-system/lib/utils";
import { SparklesIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useId, useState } from "react";

// The chat code (and the AI SDK) loads only when the user opens the panel.
const LazyWorkflowBuilderChatPanel = lazy(
  () => import("./workflow-builder-chat-panel")
);

/**
 * The "Build with AI" entry of the workflow editor: a toggle button above the
 * YAML editor and, when open, a fixed panel on the editor's right (below it on
 * narrow screens). Unless the server has the assistant switched on it renders
 * only the editor it was handed, so a disabled install looks exactly as before.
 */
export function WorkflowBuilderAssistant({
  context,
}: Readonly<{ context: WorkflowEditorAssistantContext }>) {
  const status = useWorkflowBuilderStatus({ enabled: true });
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!status.data?.enabled) {
    return context.editor;
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          size="sm"
          type="button"
          variant={open ? "secondary" : "outline"}
        >
          <SparklesIcon aria-hidden className="size-4" />
          Build with AI
        </Button>
      </div>
      {/* The editor keeps its place in the tree, so toggling the panel never remounts it. */}
      <div
        className={cn(
          "grid items-start gap-4",
          open && "lg:grid-cols-[minmax(0,1fr)_26rem]"
        )}
      >
        <div className="min-w-0">{context.editor}</div>
        {open ? (
          <aside
            aria-label="Build with AI"
            className="flex h-[36rem] min-h-0 flex-col rounded-md border bg-background lg:sticky lg:top-4"
            id={panelId}
          >
            <div className="flex items-start justify-between gap-2 p-4">
              <div className="space-y-1">
                <h2 className="font-semibold text-sm">Build with AI</h2>
                <p className="text-muted-foreground text-xs">
                  The assistant proposes workflow YAML. Nothing changes until
                  you apply and save it.
                </p>
              </div>
              <Button
                aria-label="Close the assistant panel"
                onClick={() => setOpen(false)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <XIcon aria-hidden className="size-4" />
              </Button>
            </div>
            <Suspense
              fallback={
                <p className="p-4 text-muted-foreground text-sm">Loading...</p>
              }
            >
              <LazyWorkflowBuilderChatPanel context={context} />
            </Suspense>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
