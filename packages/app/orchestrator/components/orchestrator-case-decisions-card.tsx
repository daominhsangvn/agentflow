"use client";

import {
  type OrchestratorCaseDecision,
  OrchestratorDecisionStatus,
  OrchestratorDraftOutcome,
} from "@repo/api/src/types/orchestrator";
import { formatDateTime } from "@repo/app/shared/lib/date-utils";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Textarea } from "@repo/design-system/components/ui/textarea";
import { useState } from "react";
import { useDecideOrchestratorDecision } from "../hooks/use-orchestrator-cases";

const DECISION_STATUS_LABELS: Record<OrchestratorDecisionStatus, string> = {
  [OrchestratorDecisionStatus.Pending]: "Pending",
  [OrchestratorDecisionStatus.Approved]: "Approved",
  [OrchestratorDecisionStatus.Rejected]: "Rejected",
};

const DRAFT_OUTCOME_LABELS: Record<OrchestratorDraftOutcome, string> = {
  [OrchestratorDraftOutcome.Running]: "Posting (interrupted?)",
  [OrchestratorDraftOutcome.Done]: "Posted",
  [OrchestratorDraftOutcome.Failed]: "Failed",
};

export function OrchestratorCaseDecisionsCard({
  caseId,
  decisions,
  isAdmin,
}: Readonly<{
  caseId: string;
  decisions: OrchestratorCaseDecision[];
  isAdmin: boolean;
}>) {
  if (decisions.length === 0) {
    return null;
  }
  const pending = decisions.filter(
    (decision) => decision.status === OrchestratorDecisionStatus.Pending
  );
  const decided = decisions.filter(
    (decision) => decision.status !== OrchestratorDecisionStatus.Pending
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {[...pending, ...decided].map((decision) => (
          <DecisionRow
            caseId={caseId}
            decision={decision}
            isAdmin={isAdmin}
            key={decision.id}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function DecisionRow({
  caseId,
  decision,
  isAdmin,
}: Readonly<{
  caseId: string;
  decision: OrchestratorCaseDecision;
  isAdmin: boolean;
}>) {
  const decide = useDecideOrchestratorDecision(caseId);
  const [comment, setComment] = useState("");
  const isPending = decision.status === OrchestratorDecisionStatus.Pending;

  const submit = (approved: boolean) => {
    const trimmed = comment.trim();
    decide.mutate({
      decisionId: decision.id,
      input: trimmed ? { approved, comment: trimmed } : { approved },
    });
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="whitespace-pre-wrap text-sm">{decision.question}</p>
      {decision.draft ? <DecisionDraft decision={decision} /> : null}
      {isPending ? (
        isAdmin && (
          <div className="space-y-2">
            {decision.draft ? (
              <p className="text-muted-foreground text-sm">
                Approving posts this on {decision.draft.itemKey}.
              </p>
            ) : null}
            <Textarea
              aria-label="Comment"
              onChange={(event) => setComment(event.target.value)}
              placeholder="Comment (optional)"
              value={comment}
            />
            <div className="flex gap-2">
              <Button
                disabled={decide.isPending}
                onClick={() => submit(true)}
                size="sm"
                type="button"
              >
                Approve
              </Button>
              <Button
                disabled={decide.isPending}
                onClick={() => submit(false)}
                size="sm"
                type="button"
                variant="outline"
              >
                Reject
              </Button>
            </div>
          </div>
        )
      ) : (
        <DecidedDetails decision={decision} />
      )}
    </div>
  );
}

function DecidedDetails({
  decision,
}: Readonly<{ decision: OrchestratorCaseDecision }>) {
  return (
    <div className="space-y-1 text-muted-foreground text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            decision.status === OrchestratorDecisionStatus.Approved
              ? "success"
              : "error"
          }
        >
          {DECISION_STATUS_LABELS[decision.status]}
        </Badge>
        {decision.decidedBy ? <span>by {decision.decidedBy}</span> : null}
        {decision.via ? <span>via {decision.via}</span> : null}
        {decision.decidedAt ? (
          <span>{formatDateTime(decision.decidedAt)}</span>
        ) : null}
      </div>
      {decision.comment ? (
        <p className="whitespace-pre-wrap">{decision.comment}</p>
      ) : null}
      {decision.draft ? <DraftOutcome decision={decision} /> : null}
    </div>
  );
}

function DecisionDraft({
  decision,
}: Readonly<{ decision: OrchestratorCaseDecision }>) {
  const draft = decision.draft;
  if (!draft) {
    return null;
  }
  const comment = draft.comment;
  const files = comment?.attachments.map((file) => file.name) ?? [];
  let commentLine = "";
  if (comment) {
    commentLine = `Comment on ${draft.itemKey}`;
    if (comment.replyTo) {
      commentLine += ` · reply to ${comment.replyTo}`;
    }
    if (files.length > 0) {
      commentLine += ` · files: ${files.join(", ")}`;
    }
  }

  return (
    <div className="space-y-2" data-testid="decision-draft">
      {comment ? (
        <>
          <p className="font-medium text-sm">{commentLine}</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">
            {comment.text}
          </pre>
        </>
      ) : null}
      {draft.transitionName ? (
        <p className="font-medium text-sm">
          Move {draft.itemKey} to {draft.transitionName}
        </p>
      ) : null}
    </div>
  );
}

function DraftOutcome({
  decision,
}: Readonly<{ decision: OrchestratorCaseDecision }>) {
  const result = decision.draftResult;
  if (
    decision.status !== OrchestratorDecisionStatus.Approved ||
    result === null
  ) {
    return <p>Not posted</p>;
  }
  const label = DRAFT_OUTCOME_LABELS[result.outcome];
  if (result.outcome === OrchestratorDraftOutcome.Failed) {
    return <p>{`${label}: ${result.error ?? "unknown error"}`}</p>;
  }
  if (result.outcome === OrchestratorDraftOutcome.Done) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{label}</Badge>
        {result.commentRef ? <span>{result.commentRef}</span> : null}
      </div>
    );
  }
  return <p>{label}</p>;
}
