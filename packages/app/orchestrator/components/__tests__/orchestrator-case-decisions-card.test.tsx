import {
  type OrchestratorCaseDecision,
  OrchestratorDecisionStatus,
  OrchestratorDraftOutcome,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrchestratorCaseDecisionsCard } from "../orchestrator-case-decisions-card";

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useDecideOrchestratorDecision: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DRAFT_TEXT = "Hello,\nyour leave request is approved.";

function makeDecision(
  overrides: Partial<OrchestratorCaseDecision> = {}
): OrchestratorCaseDecision {
  return {
    id: "d-1",
    conversationId: "conv-1",
    question: "Post this?",
    status: OrchestratorDecisionStatus.Pending,
    via: null,
    decidedBy: null,
    comment: null,
    decidedAt: null,
    draft: {
      itemKey: "LD-9",
      comment: { text: DRAFT_TEXT, replyTo: null, attachments: [] },
      transitionName: "Planning",
    },
    draftResult: null,
    createdAt: "2026-11-09T08:00:00.000Z",
    ...overrides,
  };
}

function renderCard(decision: OrchestratorCaseDecision) {
  return render(
    <OrchestratorCaseDecisionsCard
      caseId="case-1"
      decisions={[decision]}
      isAdmin
    />
  );
}

describe("OrchestratorCaseDecisionsCard draft", () => {
  it("shows the pending draft in full before the Approve button", () => {
    renderCard(makeDecision());

    const draft = screen.getByTestId("decision-draft");
    expect(draft.textContent).toContain("Comment on LD-9");
    expect(draft.textContent).toContain("Move LD-9 to Planning");
    expect(draft.textContent).toContain("your leave request is approved.");
    const approve = screen.getByRole("button", { name: "Approve" });
    const order = [...document.querySelectorAll("*")];
    expect(order.indexOf(draft)).toBeLessThan(order.indexOf(approve));
  });

  it("shows Posted for a done draft", () => {
    renderCard(
      makeDecision({
        status: OrchestratorDecisionStatus.Approved,
        draftResult: {
          outcome: OrchestratorDraftOutcome.Done,
          commentRef: "10001",
          transition: null,
          error: null,
          carriedOutAt: "2026-11-09T08:05:00.000Z",
        },
      })
    );

    expect(screen.getByText("Posted")).toBeTruthy();
  });

  it("shows Not posted for a rejected decision", () => {
    renderCard(makeDecision({ status: OrchestratorDecisionStatus.Rejected }));

    expect(screen.getByText("Not posted")).toBeTruthy();
  });

  it("renders a decision without a draft as before", () => {
    renderCard(makeDecision({ draft: null }));

    expect(screen.queryByTestId("decision-draft")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
