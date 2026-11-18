import type { ProposeWorkflowOutput } from "@repo/api/src/types/workflow-builder-schemas";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowBuilderProposalCard } from "../workflow-builder-proposal-card";

vi.mock("../workflow-builder-yaml-diff", () => ({
  default: ({ proposedText }: { proposedText: string }) => (
    <div data-testid="diff">{proposedText}</div>
  ),
}));

const ASK_FIX_RE = /Ask the agent/;

const VALID: ProposeWorkflowOutput = {
  valid: true,
  errorCount: 0,
  warningCount: 0,
  problems: [],
};
const INVALID: ProposeWorkflowOutput = {
  valid: false,
  errorCount: 2,
  warningCount: 1,
  problems: [{ line: 3, message: "Unknown project", isError: true }],
};

function setup(
  overrides: Partial<Parameters<typeof WorkflowBuilderProposalCard>[0]> = {}
) {
  const handlers = { onApply: vi.fn(), onRevert: vi.fn(), onAskFix: vi.fn() };
  render(
    <WorkflowBuilderProposalCard
      canRevert={false}
      currentText="name: old"
      isApplied={false}
      proposal={{ yaml: "name: new", summary: "A summary" }}
      result={VALID}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe("WorkflowBuilderProposalCard", () => {
  it("shows a valid badge and no fix button", () => {
    setup();

    expect(screen.getByText("Valid")).toBeInTheDocument();
    expect(screen.getByText("A summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ASK_FIX_RE })).toBeNull();
  });

  it("shows the errors and asks the agent to fix", async () => {
    const { onAskFix } = setup({ result: INVALID });

    expect(screen.getByText("2 errors, 1 warning")).toBeInTheDocument();
    expect(screen.getByText("Line 3: Unknown project")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Ask the agent to fix" })
    );

    expect(onAskFix).toHaveBeenCalledTimes(1);
  });

  it("shows checking while the result is pending", () => {
    setup({ result: null });

    expect(screen.getByText("Checking...")).toBeInTheDocument();
  });

  it("applies to the editor", async () => {
    const { onApply } = setup();

    await userEvent.click(
      screen.getByRole("button", { name: "Apply to editor" })
    );

    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("offers Revert only when it can", async () => {
    const { onRevert } = setup({ canRevert: true, isApplied: true });

    await userEvent.click(screen.getByRole("button", { name: "Revert" }));

    expect(onRevert).toHaveBeenCalledTimes(1);
  });

  it("hides Revert by default", () => {
    setup();

    expect(screen.queryByRole("button", { name: "Revert" })).toBeNull();
  });

  it("mounts the diff only after Show changes", async () => {
    setup();
    expect(screen.queryByTestId("diff")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show changes" }));

    expect(await screen.findByTestId("diff")).toHaveTextContent("name: new");
  });
});
