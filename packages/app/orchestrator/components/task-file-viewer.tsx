"use client";

import { setDefaultFileViewerAssetBaseUrl } from "@file-viewer/core";
import liteRenderers from "@file-viewer/preset-lite";
import officeRenderers from "@file-viewer/preset-office";
import FileViewer, { type ViewerOptions } from "@file-viewer/react";
import { useTheme } from "next-themes";
import { useMemo } from "react";

export function TaskFileViewer({
  blob,
  fileName,
}: Readonly<{ blob: Blob; fileName: string }>) {
  const { resolvedTheme } = useTheme();
  const file = useMemo(
    () => new File([blob], fileName, { type: blob.type }),
    [blob, fileName]
  );
  const options = useMemo(
    () => ({
      ...VIEWER_OPTIONS,
      theme: resolvedTheme === "dark" ? ("dark" as const) : ("light" as const),
    }),
    [resolvedTheme]
  );

  return (
    <FileViewer
      className="h-full w-full"
      data-testid="task-file-viewer"
      file={file}
      filename={fileName}
      options={options}
    />
  );
}

// Served from apps/app/public/file-viewer, copied by
// apps/app/scripts/copy-file-viewer-assets.mjs. The automatic base detection
// would pick /_next/ under Next.js, so the base is set explicitly.
const FILE_VIEWER_ASSET_BASE = "/file-viewer/";

const VIEWER_OPTIONS: ViewerOptions = {
  preset: [officeRenderers, liteRenderers],
  rendererMode: "replace",
  styleIsolation: "shadow",
  toolbar: { download: false, print: false, exportHtml: false },
};

setDefaultFileViewerAssetBaseUrl(FILE_VIEWER_ASSET_BASE);
