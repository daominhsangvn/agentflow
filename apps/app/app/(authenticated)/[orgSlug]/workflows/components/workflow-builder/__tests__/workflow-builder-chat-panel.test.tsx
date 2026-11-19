import { WorkflowBuilderToolName } from "@repo/api/src/types/workflow-builder";
import type { ProposeWorkflowOutput } from "@repo/api/src/types/workflow-builder-schemas";
import type { WorkflowEditorAssistantContext } from "@repo/app/workflows/components/workflow-editor";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkflowBuilderChatPanel, {
  MAX_AUTO_SENDS_PER_TURN,
} from "../workflow-builder-chat-panel";

const mocks = vi.hoisted(() => ({
  chatOptions: null as null | Record<string, (...args: never[]) => unknown>,
  addToolOutput: vi.fn(),
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
  messages: [] as unknown[],
  status: "ready" as string,
  loadStoredMessages: vi.fn(),
  saveStoredMessages: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: Record<string, (...args: never[]) => unknown>) => {
    mocks.chatOptions = options;
    return {
      messages: mocks.messages,
      sendMessage: mocks.sendMessage,
      setMessages: mocks.setMessages,
      addToolOutput: mocks.addToolOutput,
      status: mocks.status,
      stop: vi.fn(),
      error: undefined,
    };
  },
}));

vi.mock("@repo/app/shared/auth/use-auth-snapshot", () => ({
  useAuthSnapshot: () => ({ orgId: "org-1" }),
}));

vi.mock("@/lib/workflow-builder/use-workflow-builder-transport", () => ({
  useWorkflowBuilderTransport: () => ({}),
}));

vi.mock("@/lib/workflow-builder/chat-storage", () => ({
  workflowBuilderStorageKey: (org: string, id: string | null) =>
    `key:${org}:${id ?? "new"}`,
  loadStoredMessages: (key: string) => mocks.loadStoredMessages(key),
  saveStoredMessages: (...args: unknown[]) => mocks.saveStoredMessages(...args),
  clearStoredMessages: vi.fn(),
}));

vi.mock("../workflow-builder-yaml-diff", () => ({
  default: () => <div data-testid="diff" />,
}));

const PROPOSED_YAML = "name: Proposed\n";
const TOOL_PART_TYPE = `tool-${WorkflowBuilderToolName.ProposeWorkflow}`;
const APPLY_RE = /Apply to editor/;
const REVERT_RE = /Revert/;
const CONTINUE_NOTICE_RE = /Send a message to continue/;

const INVALID: ProposeWorkflowOutput = {
  valid: false,
  errorCount: 1,
  warningCount: 0,
  problems: [{ line: 1, message: "bad", isError: true }],
};
const VALID: ProposeWorkflowOutput = {
  valid: true,
  errorCount: 0,
  warningCount: 0,
  problems: [],
};

function makeContext(
  validate: WorkflowEditorAssistantContext["validate"] = () => VALID
): WorkflowEditorAssistantContext {
  return {
    workflowId: null,
    text: "name: Current\n",
    setText: vi.fn(),
    validate,
    editor: null,
  };
}

function proposalMessage(): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts: [
      {
        type: TOOL_PART_TYPE,
        toolCallId: "call-1",
        state: "output-available",
        input: { yaml: PROPOSED_YAML },
        output: VALID,
      },
    ],
  } as unknown as UIMessage;
}

function callToolCall(input: unknown) {
  (
    mocks.chatOptions?.onToolCall as (arg: {
      toolCall: { toolName: string; toolCallId: string; input: unknown };
    }) => void
  )({
    toolCall: {
      toolName: WorkflowBuilderToolName.ProposeWorkflow,
      toolCallId: "call-1",
      input,
    },
  });
}

async function renderPanel(context = makeContext()) {
  render(<WorkflowBuilderChatPanel context={context} />);
  await waitFor(() => expect(mocks.chatOptions).not.toBeNull());
  return context;
}

describe("WorkflowBuilderChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatOptions = null;
    mocks.messages = [];
    mocks.status = "ready";
    mocks.loadStoredMessages.mockResolvedValue([]);
  });

  it.each([
    "submitted",
    "streaming",
  ])("shows the thinking line while the status is %s", async (status) => {
    mocks.status = status;
    await renderPanel();
    expect(screen.getByTestId("workflow-builder-thinking")).toBeInTheDocument();
  });

  it("hides the thinking line when ready", async () => {
    await renderPanel();
    expect(screen.queryByTestId("workflow-builder-thinking")).toBeNull();
  });

  it("restores the stored history into the chat", async () => {
    const stored = [proposalMessage()];
    mocks.loadStoredMessages.mockResolvedValue(stored);
    await renderPanel();
    expect(mocks.loadStoredMessages).toHaveBeenCalledWith("key:org-1:new");
    expect(mocks.chatOptions).toMatchObject({
      id: "key:org-1:new",
      messages: stored,
    });
  });

  it("offers a guided start on an empty chat and sends the opening request", async () => {
    await renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Guide me" }));
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      text: expect.stringContaining("Guide me step by step"),
    });
  });

  it("hides the guided start once the chat has messages", async () => {
    mocks.messages = [proposalMessage()];
    await renderPanel();
    expect(screen.queryByRole("button", { name: "Guide me" })).toBeNull();
  });

  it("validates a proposal and answers the tool call with the result", async () => {
    const validate = vi.fn(() => VALID);
    await renderPanel(makeContext(validate));
    callToolCall({ yaml: PROPOSED_YAML });
    expect(validate).toHaveBeenCalledWith(PROPOSED_YAML);
    expect(mocks.addToolOutput).toHaveBeenCalledWith({
      tool: WorkflowBuilderToolName.ProposeWorkflow,
      toolCallId: "call-1",
      output: VALID,
    });
  });

  it("answers a malformed proposal with an error without calling validate", async () => {
    const validate = vi.fn(() => VALID);
    await renderPanel(makeContext(validate));
    callToolCall({ yaml: 42 });
    expect(validate).not.toHaveBeenCalled();
    expect(mocks.addToolOutput.mock.calls[0]?.[0].output).toMatchObject({
      valid: false,
      errorCount: 1,
    });
  });

  it("stops auto-sending after three invalid proposals in a row", async () => {
    await renderPanel(makeContext(() => INVALID));
    const autoSend = mocks.chatOptions?.sendAutomaticallyWhen as (arg: {
      messages: UIMessage[];
    }) => boolean;
    const completeWithToolCall = {
      messages: [
        {
          id: "a",
          role: "assistant",
          parts: [
            {
              type: TOOL_PART_TYPE,
              toolCallId: "call-1",
              state: "output-available",
              input: { yaml: PROPOSED_YAML },
              output: INVALID,
            },
          ],
        },
      ] as unknown as UIMessage[],
    };
    callToolCall({ yaml: PROPOSED_YAML });
    callToolCall({ yaml: PROPOSED_YAML });
    expect(autoSend(completeWithToolCall)).toBe(true);
    callToolCall({ yaml: PROPOSED_YAML });
    expect(autoSend(completeWithToolCall)).toBe(false);
  });

  it("stops auto-sending after the cap when the stream keeps ending on a server tool step", async () => {
    await renderPanel();
    const autoSend = mocks.chatOptions?.sendAutomaticallyWhen as (arg: {
      messages: UIMessage[];
    }) => boolean;
    const serverToolStep = {
      messages: [
        {
          id: "a",
          role: "assistant",
          parts: [
            { type: "step-start" },
            {
              type: "tool-read_guide",
              toolCallId: "call-guide",
              state: "output-available",
              input: { id: "workflows" },
              output: "text",
            },
          ],
        },
      ] as unknown as UIMessage[],
    };
    let sends = 0;
    for (let i = 0; i < 100 && autoSend(serverToolStep); i++) {
      sends += 1;
    }
    expect(sends).toBe(MAX_AUTO_SENDS_PER_TURN);
    expect(autoSend(serverToolStep)).toBe(false);
    expect(await screen.findByText(CONTINUE_NOTICE_RE)).toBeInTheDocument();
  });

  it("stops auto-sending after the cap on repeated valid proposals and resets on a user message", async () => {
    await renderPanel(makeContext(() => VALID));
    const autoSend = mocks.chatOptions?.sendAutomaticallyWhen as (arg: {
      messages: UIMessage[];
    }) => boolean;
    const proposal = { messages: [proposalMessage()] };
    let sends = 0;
    for (let i = 0; i < 100; i++) {
      callToolCall({ yaml: PROPOSED_YAML });
      if (!autoSend(proposal)) {
        break;
      }
      sends += 1;
    }
    expect(sends).toBe(MAX_AUTO_SENDS_PER_TURN);

    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Message to the assistant"),
      "again{Enter}"
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({ text: "again" });
    expect(autoSend(proposal)).toBe(true);
  });

  it("applies the proposal to the editor text and reverts it", async () => {
    mocks.messages = [proposalMessage()];
    const context = await renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: APPLY_RE }));
    expect(context.setText).toHaveBeenLastCalledWith(PROPOSED_YAML);
    await user.click(await screen.findByRole("button", { name: REVERT_RE }));
    expect(context.setText).toHaveBeenLastCalledWith("name: Current\n");
  });
});
