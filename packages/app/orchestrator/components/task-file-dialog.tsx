"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { DownloadIcon, XIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import {
  useDownloadOrchestratorTaskFile,
  useOrchestratorTaskFile,
} from "../hooks/use-orchestrator-cases";

// Loaded only when a dialog shows a viewer-type file.
const LazyTaskFileViewer = lazy(() =>
  import("./task-file-viewer").then((module) => ({
    default: module.TaskFileViewer,
  }))
);

export function TaskFileDialog({
  caseId,
  taskId,
  name,
  open,
  onOpenChange,
}: Readonly<{
  caseId: string;
  taskId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const kind = previewKind(name);
  const file = useOrchestratorTaskFile({
    caseId,
    taskId,
    name,
    enabled: open && kind !== PreviewKind.None,
  });
  const download = useDownloadOrchestratorTaskFile();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[90vw]"
        data-testid="task-file-dialog"
        showCloseButton={false}
      >
        <div
          className="flex items-center gap-2 border-b px-4 py-2"
          data-testid="task-file-dialog-bar"
        >
          <DialogTitle
            className="min-w-0 flex-1 truncate font-mono text-sm"
            title={name}
          >
            {name}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Task file preview
          </DialogDescription>
          <Button
            disabled={download.isPending}
            onClick={() => download.mutate({ caseId, taskId, name })}
            size="sm"
            type="button"
            variant="outline"
          >
            <DownloadIcon />
            Download
          </Button>
          <DialogClose asChild>
            <Button
              aria-label="Close"
              size="icon"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          {renderBody(
            kind,
            file.data,
            file.isPending,
            file.isError,
            name.split("/").pop() ?? name
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderBody(
  kind: PreviewKind,
  blob: Blob | undefined,
  isPending: boolean,
  isError: boolean,
  fileName: string
) {
  if (kind === PreviewKind.None) {
    return (
      <p className="p-6 text-muted-foreground">No preview for this file type</p>
    );
  }
  if (isError) {
    return <p className="p-6 text-destructive">Couldn't load the file</p>;
  }
  if (isPending || !blob) {
    return <p className="p-6 text-muted-foreground">Loading…</p>;
  }
  return (
    <Suspense fallback={<p className="p-6 text-muted-foreground">Loading…</p>}>
      <LazyTaskFileViewer blob={blob} fileName={fileName} />
    </Suspense>
  );
}

function previewKind(name: string): PreviewKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return VIEWER_EXTENSIONS.has(extension)
    ? PreviewKind.Viewer
    : PreviewKind.None;
}

const PreviewKind = {
  Viewer: "viewer",
  None: "none",
} as const;
type PreviewKind = (typeof PreviewKind)[keyof typeof PreviewKind];

const VIEWER_EXTENSIONS: ReadonlySet<string> = new Set(
  "md markdown pdf ofd doc docx docm dot dotx rtf odt xls xlsx xlsm csv ods ppt pptx pps ppsx pot potx odp pages numbers key hwp hwpx wpd txt log json yaml yml xml png jpg jpeg gif webp bmp mp3 wav ogg m4a mp4 webm".split(
    " "
  )
);
