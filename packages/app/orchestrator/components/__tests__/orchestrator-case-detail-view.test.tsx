import {
  type OrchestratorCaseDetail,
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorDocumentKind,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorTaskStatus,
  OrchestratorTurnStatus,
} from "@repo/api/src/types/orchestrator";
import { render, screen, within } from "@testing-library/react";
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
}));

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  isCaseActive: () => true,
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

const ELAPSED_OPEN_RE = /^Elapsed .*\(open\)$/;

describe("OrchestratorCaseDetailView", () => {
  beforeEach(() => {
    mocks.query.data = makeDetail();
    mocks.query.isLoading = false;
    mocks.query.error = null;
    mocks.decideMutate.mockReset();
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
  });

  it("lists task files with size and skipped reason", () => {
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
});
