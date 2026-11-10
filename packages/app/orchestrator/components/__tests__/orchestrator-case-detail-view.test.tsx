import {
  type OrchestratorCaseDetail,
  type OrchestratorCaseMessage,
  OrchestratorCaseStatus,
  type OrchestratorCaseTask,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorDocumentKind,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  OrchestratorTurnStatus,
} from "@repo/api/src/types/orchestrator";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorCaseDetailView } from "../orchestrator-case-detail-view";

const CASE_ID = "case-1";
const CONV = "conv-1";
const TURN = "turn-1";
const DECISION_ID = "dec-1";
const LOOP_ID = "loop-9";

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as OrchestratorCaseDetail | undefined,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  decideMutate: vi.fn(),
  deleteMutateAsync: vi.fn(),
  replace: vi.fn(),
  active: true,
}));

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  isCaseActive: () => mocks.active,
  useDeleteOrchestratorCase: () => ({
    mutateAsync: mocks.deleteMutateAsync,
    isPending: false,
  }),
  useOrchestratorCase: () => mocks.query,
  useSetOrchestratorCaseStatus: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDecideOrchestratorDecision: () => ({
    mutate: mocks.decideMutate,
    isPending: false,
  }),
  useCancelOrchestratorTurn: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  usePostOrchestratorCaseMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../orchestrator-case-work-cards", () => ({
  OrchestratorCaseWorkCards: () => <div data-testid="work-cards" />,
}));

vi.mock("@repo/navigation/use-navigation", () => ({
  useNavigation: () => ({
    replace: mocks.replace,
    navigate: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

function makeDetail(): OrchestratorCaseDetail {
  return {
    id: CASE_ID,
    projectId: "p1",
    workflowId: "w1",
    title: "PROJ-7",
    sourceKey: null,
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 1,
    activeTaskCount: 1,
    turnRunning: true,
    taskCount: 1,
    turnCount: 2,
    costUsd: null,
    inputTokens: 1200,
    outputTokens: 300,
    activeMs: 5_400_000,
    closedAt: null,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:10:00.000Z",
    notes: "",
    project: { id: "p1", name: "Web" },
    workflow: { id: "w1", name: "Orchestrated" },
    conversations: [
      {
        id: CONV,
        channelKey: "jira:PROJ-7",
        status: OrchestratorConversationStatus.Turn,
        createdAt: "2026-10-26T08:00:00.000Z",
        messages: [
          {
            id: "m1",
            conversationId: CONV,
            origin: OrchestratorMessageOrigin.External,
            kind: OrchestratorMessageKind.Message,
            actor: "Ann",
            text: "hello there",
            turnId: TURN,
            createdAt: "2026-10-26T08:00:00.000Z",
          },
        ],
        turns: [
          {
            id: TURN,
            conversationId: CONV,
            status: OrchestratorTurnStatus.Running,
            ended: null,
            summary: null,
            error: null,
            usage: null,
            runnerName: "runner-dev",
            startedAt: "2026-10-26T08:01:00.000Z",
            finishedAt: null,
          },
        ],
      },
    ],
    tasks: [
      {
        id: "task-1",
        conversationId: CONV,
        turnId: TURN,
        command: "/plan",
        args: "PROJ-7",
        prompt: "",
        mode: "plan",
        runnerName: null,
        computeTargetId: null,
        status: OrchestratorTaskStatus.Running,
        fork: false,
        resumeTaskId: null,
        loopId: LOOP_ID,
        reply: null,
        files: [
          { name: "plan.md", size: 12_595, stored: true, skipped: null },
          { name: "big.bin", size: 900, stored: false, skipped: "too large" },
        ],
        filesOmitted: 0,
        openQuestionCount: 0,
        inputs: [],
        replyTo: null,
        replyToMessageId: null,
        questions: [],
        error: null,
        waiting: null,
        createdAt: "2026-10-26T08:02:00.000Z",
        finishedAt: null,
      },
    ],
    waits: [],
    decisions: [
      {
        id: DECISION_ID,
        conversationId: CONV,
        question: "Approve?",
        status: OrchestratorDecisionStatus.Pending,
        via: null,
        decidedBy: null,
        comment: null,
        decidedAt: null,
        draft: null,
        draftResult: null,
        createdAt: "2026-10-26T08:06:00.000Z",
      },
    ],
    documents: [
      {
        pageId: "p1",
        title: "Plan page",
        url: "https://wiki.test/p1",
        kind: OrchestratorDocumentKind.Plan,
        version: 3,
        attachments: ["a.png", "b.png"],
        publishedAt: "2026-10-26T08:05:00.000Z",
      },
      {
        pageId: "p2",
        title: "Test plan page",
        url: "https://wiki.test/p2",
        kind: OrchestratorDocumentKind.TestPlan,
        version: 1,
        attachments: [],
        publishedAt: "2026-10-26T08:06:00.000Z",
      },
    ],
  };
}

function withTask(patch: Partial<OrchestratorCaseTask>) {
  const detail = makeDetail();
  mocks.query.data = {
    ...detail,
    tasks: detail.tasks.map((task) => ({ ...task, ...patch })),
  };
}

function addMessages(
  patch: Pick<
    OrchestratorCaseMessage,
    "id" | "origin" | "kind" | "actor" | "text"
  > &
    Partial<OrchestratorCaseMessage>
) {
  const detail = mocks.query.data ?? makeDetail();
  const conversation = detail.conversations[0];
  conversation?.messages.push({
    conversationId: CONV,
    turnId: TURN,
    createdAt: "2026-10-26T08:01:30.000Z",
    ...patch,
  });
  mocks.query.data = detail;
}

const ELAPSED_OPEN_RE = /^Elapsed .*\(open\)$/;

describe("OrchestratorCaseDetailView", () => {
  beforeEach(() => {
    mocks.query.data = makeDetail();
    mocks.query.isLoading = false;
    mocks.query.error = null;
    mocks.decideMutate.mockReset();
    mocks.deleteMutateAsync.mockReset();
    mocks.deleteMutateAsync.mockResolvedValue({ deleted: true });
    mocks.replace.mockReset();
    mocks.active = true;
  });

  it("approves a pending decision", async () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(mocks.decideMutate).toHaveBeenCalledWith({
      decisionId: DECISION_ID,
      input: { approved: true },
    });
  });

  it("lists the published documents as external links", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const card = screen.getByTestId("orchestrator-case-documents");
    const link = within(card).getByRole("link", { name: "Plan page" });
    expect(link.getAttribute("href")).toBe("https://wiki.test/p1");
    expect(
      within(card).getByRole("link", { name: "Test plan page" })
    ).toBeTruthy();
    expect(within(card).getByText("v3")).toBeTruthy();
    expect(within(card).getByText("2 attachments")).toBeTruthy();
  });

  it("shows no documents card for an empty list", () => {
    mocks.query.data = { ...makeDetail(), documents: [] };
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.queryByTestId("orchestrator-case-documents")).toBeNull();
  });

  it("hides admin actions for members", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin={false} />);

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop turn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close case" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete case" })).toBeNull();
  });

  it("deletes an inactive case after confirmation and leaves the page", async () => {
    mocks.active = false;
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    await userEvent.click(screen.getByRole("button", { name: "Delete case" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete case",
      })
    );

    await waitFor(() => expect(mocks.deleteMutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/acme/workflows/w1?tab=cases")
    );
  });

  it("disables delete while the case is active", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByRole("button", { name: "Delete case" })).toBeDisabled();
  });

  it("lists task files with size and skipped reason", () => {
    withTask({
      status: OrchestratorTaskStatus.Succeeded,
      finishedAt: "2026-10-26T08:04:00.000Z",
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const list = screen.getByTestId("orchestrator-task-files");
    expect(list).toHaveTextContent("plan.md");
    expect(list).toHaveTextContent("12.3 KB");
    expect(list).toHaveTextContent("big.bin");
    expect(list).toHaveTextContent("too large");
  });

  it("links a task to its loop", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByRole("link", { name: "Open loop" })).toHaveAttribute(
      "href",
      `/acme/loops/${LOOP_ID}`
    );
  });

  it("links the header to the workflow's cases tab and shows the cost", () => {
    mocks.query.data = { ...makeDetail(), costUsd: 1.5 };
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByRole("link", { name: "Orchestrated" })).toHaveAttribute(
      "href",
      "/acme/workflows/w1?tab=cases"
    );
    expect(screen.getByText("$1.50", { exact: false })).toBeInTheDocument();
  });

  it("shows active time, tokens and elapsed time for an open case", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByText("active 1h 30m", { exact: false })).toBeTruthy();
    expect(screen.getByText("1.50k tokens", { exact: false })).toBeTruthy();
    expect(screen.getByText(ELAPSED_OPEN_RE)).toBeTruthy();
  });

  it("shows the elapsed time up to the close of a closed case", () => {
    mocks.query.data = {
      ...makeDetail(),
      status: OrchestratorCaseStatus.Closed,
      closedAt: "2026-10-26T10:30:00.000Z",
    };
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByText("Elapsed 2h 30m")).toBeTruthy();
  });

  it("says the cost is unknown when it is null", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(
      screen.getByText("cost unknown", { exact: false })
    ).toBeInTheDocument();
  });

  it("shows a dash, not $0.00, when usage is unknown", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("labels the actors and never says Turn", () => {
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByTestId("case-timeline-person")).toHaveTextContent("Ann");
    expect(screen.getByTestId("case-timeline-orchestrator")).toHaveTextContent(
      "Orchestrator"
    );
    expect(screen.queryByText("Turn")).toBeNull();
  });

  it("shows what was sent to the agent", () => {
    withTask({ prompt: "Plan the fix", mode: "write" });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const sent = screen.getByTestId("case-timeline-sent");
    expect(sent).toHaveTextContent("Sent to");
    expect(sent).toHaveTextContent("/plan PROJ-7");
    expect(sent).toHaveTextContent("Modewrite");
    expect(sent).toHaveTextContent("Plan the fix");
  });

  it("shows inputs and the answered message of a failed task", () => {
    mocks.query.data = {
      ...makeDetail(),
      tasks: [
        { ...makeDetail().tasks[0], id: "task-0", runnerName: "dev-agent" },
        {
          ...makeDetail().tasks[0],
          id: "task-2",
          status: OrchestratorTaskStatus.Failed,
          inputs: [
            { name: "PRD.md", size: 1200, fromTaskId: "task-0", page: null },
            {
              name: "Spec.md",
              size: 5,
              fromTaskId: null,
              page: { title: "Spec", url: "https://x/wiki/p1", version: 2 },
            },
          ],
          replyTo: "c-1",
          replyToMessageId: "m1",
        },
      ],
    };
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const sent = screen.getAllByTestId("case-timeline-sent")[1] as HTMLElement;
    expect(sent).toHaveTextContent("PRD.md");
    expect(sent).toHaveTextContent("dev-agent");
    expect(within(sent).getByRole("link", { name: "Spec" })).toHaveAttribute(
      "href",
      "https://x/wiki/p1"
    );
    expect(sent).toHaveTextContent("Ann:");
  });

  it("shows a non-http Confluence page url as plain text", () => {
    withTask({
      inputs: [
        {
          name: "Spec.md",
          size: 5,
          fromTaskId: null,
          page: { title: "Spec", url: "javascript:alert(1)", version: 2 },
        },
      ],
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const sent = screen.getByTestId("case-timeline-sent");
    expect(sent).toHaveTextContent("Confluence page Spec v2");
    expect(within(sent).queryByRole("link", { name: "Spec" })).toBeNull();
  });

  it("cuts a long prompt and expands it on demand", async () => {
    const prompt = `${"a".repeat(600)}END`;
    withTask({ prompt });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const sent = screen.getByTestId("case-timeline-sent");
    expect(sent).not.toHaveTextContent("END");
    await userEvent.click(
      within(sent).getByRole("button", { name: "Show more" })
    );
    expect(sent).toHaveTextContent("END");
  });

  it("shows an agent's answer once, in its own entry", () => {
    withTask({
      status: OrchestratorTaskStatus.Succeeded,
      finishedAt: "2026-10-26T08:04:00.000Z",
      reply: "The answer",
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const found = screen.getAllByText("The answer");
    expect(found).toHaveLength(1);
    expect(
      found[0]?.closest('[data-testid="case-timeline-agent"]')
    ).not.toBeNull();
  });

  it("keeps internal inputs in the details, not as rows", () => {
    addMessages({
      id: "m2",
      origin: OrchestratorMessageOrigin.Internal,
      kind: OrchestratorMessageKind.TaskResults,
      actor: null,
      text: "Results for the model",
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    const text = screen.getByText("Results for the model");
    expect(text.closest("details")).not.toBeNull();
    expect(
      screen
        .getAllByTestId("case-timeline-person")
        .some((row) => row.textContent?.includes("Results for the model"))
    ).toBe(false);
  });

  it("puts the summary in the details when the turn replied", () => {
    const detail = makeDetail();
    const conversation = detail.conversations[0];
    if (conversation?.turns[0]) {
      conversation.turns[0].summary = "Turn summary";
    }
    mocks.query.data = detail;
    addMessages({
      id: "m3",
      origin: OrchestratorMessageOrigin.Internal,
      kind: OrchestratorMessageKind.Reply,
      actor: "AgentFlow",
      text: "Reply text",
      via: OrchestratorMessageVia.AgentFlow,
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByText("Reply text").closest("details")).toBeNull();
    expect(screen.getByText("Turn summary").closest("details")).not.toBeNull();
  });

  it("shows a refused tool call in the orchestrator block", () => {
    addMessages({
      id: "m4",
      origin: OrchestratorMessageOrigin.Internal,
      kind: OrchestratorMessageKind.ToolRefused,
      actor: null,
      text: "task_run refused: nope",
    });
    render(<OrchestratorCaseDetailView caseId={CASE_ID} isAdmin />);

    expect(screen.getByTestId("case-timeline-orchestrator")).toHaveTextContent(
      "Refused:"
    );
  });
});
