import {
  type OrchestratorCaseDetail,
  OrchestratorCaseStatus,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCaseThread } from "../agent-case-thread";

const CASE_ID = "case-1";
const CONV = "conv-1";
const BA_ID = "target-ba";

const mocks = vi.hoisted(() => ({
  data: undefined as OrchestratorCaseDetail | undefined,
  postMutateAsync: vi.fn(),
}));

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useOrchestratorCase: () => ({
    data: mocks.data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePostOrchestratorCaseMessage: () => ({
    mutateAsync: mocks.postMutateAsync,
    isPending: false,
  }),
  useDecideOrchestratorDecision: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelOrchestratorTurn: () => ({
    mutateAsync: vi.fn(),
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

function makeDetail(conversationCount = 1): OrchestratorCaseDetail {
  const conversations = Array.from({ length: conversationCount }, (_, i) => ({
    id: i === 0 ? CONV : `conv-${i + 1}`,
    channelKey: `jira:PROJ-${i + 7}`,
    status: OrchestratorConversationStatus.Idle,
    createdAt: "2026-10-26T08:00:00.000Z",
    messages: [
      {
        id: `m${i}`,
        conversationId: i === 0 ? CONV : `conv-${i + 1}`,
        origin: OrchestratorMessageOrigin.External,
        kind: OrchestratorMessageKind.Message,
        actor: "Ann",
        text: "hello there",
        turnId: null,
        createdAt: "2026-10-26T08:00:00.000Z",
      },
    ],
    turns: [],
  }));
  return {
    id: CASE_ID,
    projectId: "p1",
    workflowId: "w1",
    title: "Leave request",
    sourceKey: "PROJ-7",
    status: OrchestratorCaseStatus.Open,
    conversationCount,
    pendingDecisionCount: 1,
    activeTaskCount: 0,
    turnRunning: false,
    taskCount: 1,
    turnCount: 0,
    costUsd: null,
    inputTokens: 0,
    outputTokens: 0,
    activeMs: 0,
    closedAt: null,
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:10:00.000Z",
    notes: "",
    project: { id: "p1", name: "Web" },
    workflow: { id: "w1", name: "Orchestrated" },
    conversations,
    tasks: [
      {
        id: "task-1",
        conversationId: CONV,
        turnId: null,
        command: "/plan",
        args: "PROJ-7",
        prompt: "Plan it",
        mode: "plan",
        runnerName: "ba",
        computeTargetId: BA_ID,
        status: OrchestratorTaskStatus.Succeeded,
        fork: false,
        resumeTaskId: null,
        loopId: null,
        reply: null,
        files: [],
        filesOmitted: 0,
        openQuestionCount: 1,
        questions: [{ id: "q1", question: "Which team?" }],
        error: null,
        waiting: null,
        createdAt: "2026-10-26T08:02:00.000Z",
        finishedAt: "2026-10-26T08:03:00.000Z",
      },
    ],
    waits: [],
    decisions: [
      {
        id: "dec-1",
        conversationId: CONV,
        question: "Approve the plan?",
        status: OrchestratorDecisionStatus.Pending,
        via: null,
        decidedBy: null,
        comment: null,
        decidedAt: null,
        createdAt: "2026-10-26T08:06:00.000Z",
      },
    ],
    documents: [],
  };
}

function renderThread(node: { id: string; name: string }) {
  return render(
    <AgentCaseThread caseId={CASE_ID} isAdmin node={node} onBack={vi.fn()} />
  );
}

describe("AgentCaseThread", () => {
  beforeEach(() => {
    mocks.postMutateAsync.mockReset();
    mocks.data = makeDetail();
  });

  it("shows decisions and the timeline for the orchestrator", () => {
    renderThread({ id: "orchestrator", name: "Orchestrator" });

    expect(screen.getByText("Approve the plan?")).toBeTruthy();
    expect(screen.getByText("hello there")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open" }).getAttribute("href")
    ).toBe(`/acme/orchestrator/cases/${CASE_ID}`);
  });

  it("shows the conversation picker only with two conversations", () => {
    mocks.data = makeDetail(2);
    renderThread({ id: "orchestrator", name: "Orchestrator" });

    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("shows the agent questions and rows, and posts with toAgentId", async () => {
    const user = userEvent.setup();
    renderThread({ id: BA_ID, name: "BA" });

    expect(screen.getByText("BA asks (1)")).toBeTruthy();
    expect(screen.getByText("Orchestrator → BA")).toBeTruthy();
    expect(screen.getByText("BA → Orchestrator")).toBeTruthy();

    await user.type(
      screen.getByLabelText("Ask BA about PROJ-7"),
      "any update?"
    );
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(mocks.postMutateAsync).toHaveBeenCalledWith({
      conversationId: CONV,
      text: "any update?",
      toAgentId: BA_ID,
    });
  });

  it("explains when the agent has no task in the case", () => {
    renderThread({ id: "other", name: "QC" });

    expect(screen.getByText("QC has no task in this case yet.")).toBeTruthy();
  });
});
