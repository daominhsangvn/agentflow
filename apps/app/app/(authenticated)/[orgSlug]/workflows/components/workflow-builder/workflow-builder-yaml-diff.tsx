"use client";

import { branchDiffViewerStyles } from "@repo/app/branches/components/diff/branch-diff-viewer-theme";
import { useTheme } from "next-themes";
import ReactDiffViewer from "react-diff-viewer-continued";

type WorkflowBuilderYamlDiffProps = {
  currentText: string;
  proposedText: string;
};

/** Unified diff of the editor text against the proposal; loaded only when asked for. */
export default function WorkflowBuilderYamlDiff({
  currentText,
  proposedText,
}: Readonly<WorkflowBuilderYamlDiffProps>) {
  const { resolvedTheme } = useTheme();

  return (
    <div className="max-h-96 overflow-auto rounded-md border text-xs">
      <ReactDiffViewer
        newValue={proposedText}
        oldValue={currentText}
        splitView={false}
        styles={branchDiffViewerStyles}
        useDarkTheme={resolvedTheme === "dark"}
      />
    </div>
  );
}
