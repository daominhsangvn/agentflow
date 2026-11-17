"use client";

import type {
  ProposeWorkflowInput,
  ProposeWorkflowOutput,
} from "@repo/api/src/types/workflow-builder-schemas";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import { lazy, Suspense, useState } from "react";

// The diff library loads only when the user asks to see the changes.
const LazyWorkflowBuilderYamlDiff = lazy(
  () => import("./workflow-builder-yaml-diff")
);

type WorkflowBuilderProposalCardProps = {
  proposal: ProposeWorkflowInput;
  /** The browser's check of the proposal; null while it runs. */
  result: ProposeWorkflowOutput | null;
  currentText: string;
  isApplied: boolean;
  canRevert: boolean;
  onApply: () => void;
  onRevert: () => void;
  onAskFix: () => void;
};

/** A workflow YAML proposed by the assistant: its check, a diff, and Apply / Revert / Ask to fix. */
export function WorkflowBuilderProposalCard({
  proposal,
  result,
  currentText,
  isApplied,
  canRevert,
  onApply,
  onRevert,
  onAskFix,
}: Readonly<WorkflowBuilderProposalCardProps>) {
  const [showDiff, setShowDiff] = useState(false);
  const problems = result?.problems ?? [];

  return (
    <div
      className="space-y-2 rounded-md border p-3 text-sm"
      data-testid="workflow-builder-proposal"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Proposed workflow</span>
        <ProposalBadge result={result} />
        {isApplied ? <Badge variant="info">Applied</Badge> : null}
      </div>
      {proposal.summary ? (
        <p className="text-muted-foreground">{proposal.summary}</p>
      ) : null}
      {problems.length > 0 ? (
        <ul aria-label="Proposal problems" className="space-y-1">
          {problems.map((problem) => (
            <li
              className={
                problem.isError ? "text-destructive" : "text-muted-foreground"
              }
              key={`${problem.line}-${problem.message}`}
            >
              Line {problem.line}: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        onClick={() => setShowDiff((shown) => !shown)}
        size="sm"
        type="button"
        variant="ghost"
      >
        {showDiff ? "Hide changes" : "Show changes"}
      </Button>
      {showDiff ? (
        <Suspense
          fallback={<p className="text-muted-foreground text-xs">Loading...</p>}
        >
          <LazyWorkflowBuilderYamlDiff
            currentText={currentText}
            proposedText={proposal.yaml}
          />
        </Suspense>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onApply} size="sm" type="button">
          Apply to editor
        </Button>
        {canRevert ? (
          <Button onClick={onRevert} size="sm" type="button" variant="outline">
            Revert
          </Button>
        ) : null}
        {result && result.errorCount > 0 ? (
          <Button onClick={onAskFix} size="sm" type="button" variant="outline">
            Ask the agent to fix
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Applying only changes the editor. Press Save to keep it.
      </p>
    </div>
  );
}

function ProposalBadge({
  result,
}: Readonly<{ result: ProposeWorkflowOutput | null }>) {
  if (!result) {
    return <Badge variant="secondary">Checking...</Badge>;
  }
  if (result.errorCount > 0) {
    const label =
      result.errorCount === 1 ? "1 error" : `${result.errorCount} errors`;
    return (
      <Badge variant="error">{withWarnings(label, result.warningCount)}</Badge>
    );
  }
  return (
    <Badge variant="success">
      {withWarnings("Valid", result.warningCount)}
    </Badge>
  );
}

function withWarnings(label: string, warningCount: number): string {
  if (warningCount === 0) {
    return label;
  }
  const noun = warningCount === 1 ? "1 warning" : `${warningCount} warnings`;
  return `${label}, ${noun}`;
}
