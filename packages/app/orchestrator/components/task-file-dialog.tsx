"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@repo/design-system/components/ui/dialog";
import { MarkdownContent } from "@repo/design-system/components/ui/primitives/markdown-content";
import { useEffect, useState } from "react";
import remarkBreaks from "remark-breaks";
import {
  useDownloadOrchestratorTaskFile,
  useOrchestratorTaskFile,
} from "../hooks/use-orchestrator-cases";

const REMARK_PLUGINS = [remarkBreaks];

const PreviewKind = {
  Markdown: "markdown",
  Text: "text",
  Image: "image",
  None: "none",
} as const;
type PreviewKind = (typeof PreviewKind)[keyof typeof PreviewKind];

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt",
  "log",
  "json",
  "csv",
  "yaml",
  "yml",
]);
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all font-mono text-sm">
            {name}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-16 text-sm">
          {renderBody(kind, file.data, file.isPending, file.isError)}
        </div>
        <div>
          <Button
            disabled={download.isPending}
            onClick={() => download.mutate({ caseId, taskId, name })}
            size="sm"
            type="button"
            variant="outline"
          >
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderBody(
  kind: PreviewKind,
  blob: Blob | undefined,
  isPending: boolean,
  isError: boolean
) {
  if (kind === PreviewKind.None) {
    return (
      <p className="text-muted-foreground">No preview for this file type</p>
    );
  }
  if (isError) {
    return <p className="text-destructive">Couldn't load the file</p>;
  }
  if (isPending || !blob) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (kind === PreviewKind.Image) {
    return <ImagePreview blob={blob} />;
  }
  return <TextPreview blob={blob} markdown={kind === PreviewKind.Markdown} />;
}

function TextPreview({
  blob,
  markdown,
}: Readonly<{ blob: Blob; markdown: boolean }>) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    blob
      .text()
      .then((value) => {
        if (!cancelled) {
          setText(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setText("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (text === null) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (markdown) {
    return (
      <MarkdownContent
        className="break-words"
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        text={text}
      />
    );
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
      {text}
    </pre>
  );
}

function ImagePreview({ blob }: Readonly<{ blob: Blob }>) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    return null;
  }
  return (
    // biome-ignore lint/performance/noImgElement: next/image is not available in packages/app
    // biome-ignore lint/correctness/useImageSize: object URL preview, dimensions unknown
    <img alt="" className="max-w-full" src={url} />
  );
}

function previewKind(name: string): PreviewKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "md") {
    return PreviewKind.Markdown;
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return PreviewKind.Text;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return PreviewKind.Image;
  }
  return PreviewKind.None;
}
