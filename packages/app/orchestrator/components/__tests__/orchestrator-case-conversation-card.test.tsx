import {
  type OrchestratorCaseConversation,
  type OrchestratorCaseMessage,
  type OrchestratorCaseTask,
  OrchestratorConversationStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationMessageForm } from "../conversation-message-form";
import { OrchestratorCaseConversationCard } from "../orchestrator-case-conversation-card";

const CASE_ID = "case-1";
const CONV_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "q1";
const QUESTION = "Which database?";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useCancelOrchestratorTurn: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  usePostOrchestratorCaseMessage: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("OrchestratorCaseConversationCard", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue({});
  });

  it("submits the answers of a pending question", async () => {
    const user = userEvent.setup();
    renderCard([makeTask()]);

    await user.type(screen.getByLabelText(QUESTION), "Postgres");
    await user.click(screen.getByRole("button", { name: "Send answers" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      answers: [
        { taskId: TASK_ID, questionId: QUESTION_ID, answer: "Postgres" },
      ],
    });
  });

  it("fills the answer from an option button", async () => {
    const user = userEvent.setup();
    renderCard([makeTask()]);

    await user.click(screen.getByRole("button", { name: "MySQL" }));

    expect(screen.getByLabelText(QUESTION)).toHaveValue("MySQL");
  });

  it("shows the form when open questions remain even if an earlier message answered", () => {
    renderCard([makeTask()], null, [TASK_ID]);

    expect(
      screen.getByRole("button", { name: "Send answers" })
    ).toBeInTheDocument();
  });

  it("shows no form when no question is open", () => {
    renderCard([makeTask({ openQuestionCount: 0 })]);

    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(screen.getByText(QUESTION)).toBeInTheDocument();
  });

  it("keeps the form when only a forked follow-up task exists", () => {
    renderCard([
      makeTask(),
      makeTask({
        id: "33333333-3333-4333-8333-333333333333",
        resumeTaskId: TASK_ID,
        fork: true,
        questions: [],
        openQuestionCount: 0,
      }),
    ]);

    expect(
      screen.getByRole("button", { name: "Send answers" })
    ).toBeInTheDocument();
  });

  it("shows a note instead of the form after sending", async () => {
    const user = userEvent.setup();
    renderCard([makeTask()]);

    await user.type(screen.getByLabelText(QUESTION), "Postgres");
    await user.click(screen.getByRole("button", { name: "Send answers" }));

    expect(
      await screen.findByTestId("orchestrator-task-answers-sent")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
  });

  it("posts the text of the message box", async () => {
    const user = userEvent.setup();
    renderCard([]);

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(
      screen.getByLabelText("Message the orchestrator"),
      "Go ahead"
    );
    await user.click(send);

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      text: "Go ahead",
    });
  });

  it("sends toAgentId when given", async () => {
    const user = userEvent.setup();
    const agentId = "55555555-5555-4555-8555-555555555555";
    render(
      <ConversationMessageForm
        caseId={CASE_ID}
        conversationId={CONV_ID}
        toAgentId={agentId}
      />
    );

    await user.type(screen.getByLabelText("Message the orchestrator"), "Hi");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      text: "Hi",
      toAgentId: agentId,
    });
  });

  it("says a message was written on the case page", () => {
    renderCard([], OrchestratorMessageVia.AgentFlow);

    expect(screen.getByText("Message on the case page")).toBeInTheDocument();
  });

  it("renders message text as markdown", () => {
    renderCard([], null, [], "## Plan\n\n- **first** step\n- `code` step");

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("first").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
  });

  it("drops raw HTML in message text", () => {
    renderCard([], null, [], "<b>bold</b> plain");

    expect(screen.queryByText("bold")).not.toBeInTheDocument();
  });
});

function renderCard(
  tasks: OrchestratorCaseTask[],
  via: OrchestratorMessageVia | null = null,
  answeredTaskIds: string[] = [],
  text = "hello there"
) {
  const message: OrchestratorCaseMessage = {
    id: "m1",
    conversationId: CONV_ID,
    origin: OrchestratorMessageOrigin.External,
    kind: OrchestratorMessageKind.Message,
    actor: "Ann",
    text,
    turnId: null,
    createdAt: "2026-10-26T08:00:00.000Z",
    via,
    answeredTaskIds,
  };
  const conversation: OrchestratorCaseConversation = {
    id: CONV_ID,
    channelKey: "jira:PROJ-7",
    status: OrchestratorConversationStatus.Waiting,
    createdAt: "2026-10-26T08:00:00.000Z",
    messages: [message],
    turns: [],
  };
  return render(
    <OrchestratorCaseConversationCard
      caseId={CASE_ID}
      conversation={conversation}
      isAdmin={false}
      tasks={tasks}
    />
  );
}

function makeTask(
  overrides: Partial<OrchestratorCaseTask> = {}
): OrchestratorCaseTask {
  return {
    id: TASK_ID,
    conversationId: CONV_ID,
    turnId: null,
    command: "/plan",
    args: "PROJ-7",
    prompt: "",
    mode: "plan",
    runnerName: null,
    computeTargetId: null,
    status: OrchestratorTaskStatus.Succeeded,
    fork: false,
    resumeTaskId: null,
    loopId: null,
    reply: null,
    files: [],
    filesOmitted: 0,
    openQuestionCount: 1,
    inputs: [],
    replyTo: null,
    replyToMessageId: null,
    questions: [
      { id: QUESTION_ID, question: QUESTION, options: ["MySQL", "Postgres"] },
    ],
    error: null,
    waiting: null,
    createdAt: "2026-10-26T08:02:00.000Z",
    finishedAt: "2026-10-26T08:03:00.000Z",
    ...overrides,
  };
}
