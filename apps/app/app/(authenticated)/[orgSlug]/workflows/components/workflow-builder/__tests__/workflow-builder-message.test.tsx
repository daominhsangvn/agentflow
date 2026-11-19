import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkflowBuilderBubbleRole,
  WorkflowBuilderTextBubble,
} from "../workflow-builder-message";

const BOLD_RE = /\*\*x\*\*/;

describe("WorkflowBuilderTextBubble", () => {
  it("renders assistant text as markdown", () => {
    const { container } = render(
      <WorkflowBuilderTextBubble
        role={WorkflowBuilderBubbleRole.Assistant}
        text={"**bold**\n\n- a\n- b"}
      />
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("keeps user text plain", () => {
    const { container } = render(
      <WorkflowBuilderTextBubble
        role={WorkflowBuilderBubbleRole.User}
        text="**x**"
      />
    );
    expect(container.querySelector("strong")).toBeNull();
    expect(screen.getByText(BOLD_RE)).toBeInTheDocument();
  });

  it("aligns rows by role and text left inside bubbles", () => {
    render(
      <>
        <WorkflowBuilderTextBubble
          role={WorkflowBuilderBubbleRole.User}
          text="hi"
        />
        <WorkflowBuilderTextBubble
          role={WorkflowBuilderBubbleRole.Assistant}
          text="hello"
        />
      </>
    );
    const rows = screen.getAllByTestId("workflow-builder-message");
    expect(rows[0]).toHaveClass("justify-end");
    expect(rows[1]).toHaveClass("justify-start");
    for (const row of rows) {
      expect(row.firstElementChild).toHaveClass("text-left");
    }
  });
});
