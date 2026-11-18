import type { WorkflowEditorAssistantContext } from "@repo/app/workflows/components/workflow-editor";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowBuilderAssistant } from "../workflow-builder-assistant";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  panelMounted: vi.fn(),
}));

vi.mock("@repo/app/workflows/hooks/use-workflow-builder-status", () => ({
  useWorkflowBuilderStatus: () => mocks.status(),
}));

vi.mock("../workflow-builder-chat-panel", () => {
  return {
    default: () => {
      mocks.panelMounted();
      return <div data-testid="chat-panel" />;
    },
  };
});

const BUILD_RE = /Build with AI/;
const CONTEXT: WorkflowEditorAssistantContext = {
  workflowId: null,
  text: "",
  setText: vi.fn(),
  validate: vi.fn(),
  editor: <div data-testid="yaml-editor" />,
};

describe("WorkflowBuilderAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the editor and mounts no chat when the assistant is disabled", () => {
    mocks.status.mockReturnValue({ data: { enabled: false } });
    const { container } = render(
      <WorkflowBuilderAssistant context={CONTEXT} />
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(screen.getByTestId("yaml-editor"));
    expect(screen.queryByRole("button", { name: BUILD_RE })).toBeNull();
    expect(mocks.panelMounted).not.toHaveBeenCalled();
  });

  it("renders only the editor while the status loads", () => {
    mocks.status.mockReturnValue({ data: undefined });
    const { container } = render(
      <WorkflowBuilderAssistant context={CONTEXT} />
    );
    expect(container.firstElementChild).toBe(screen.getByTestId("yaml-editor"));
    expect(screen.queryByRole("button", { name: BUILD_RE })).toBeNull();
  });

  it("mounts the chat panel only after the button is clicked", async () => {
    mocks.status.mockReturnValue({ data: { enabled: true } });
    render(<WorkflowBuilderAssistant context={CONTEXT} />);
    expect(mocks.panelMounted).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: BUILD_RE }));
    expect(await screen.findByTestId("chat-panel")).toBeInTheDocument();
  });

  it("toggles the panel beside the editor without remounting the editor", async () => {
    mocks.status.mockReturnValue({ data: { enabled: true } });
    render(<WorkflowBuilderAssistant context={CONTEXT} />);
    const editor = screen.getByTestId("yaml-editor");
    const toggle = screen.getByRole("button", { name: BUILD_RE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("complementary", { name: BUILD_RE })
    ).toContainElement(await screen.findByTestId("chat-panel"));
    expect(screen.getByTestId("yaml-editor")).toBe(editor);

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("chat-panel")).toBeNull();
    expect(screen.getByTestId("yaml-editor")).toBe(editor);
  });
});
