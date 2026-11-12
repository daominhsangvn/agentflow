import {
  type OrchestratorCaseConversation,
  type OrchestratorCaseMessage,
  OrchestratorConversationStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorConversationTimeline } from "../orchestrator-case-timeline";

const fileQuery = vi.fn();

vi.mock("../../hooks/use-orchestrator-cases", () => ({
  useCancelOrchestratorTurn: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDownloadOrchestratorTaskFile: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useOrchestratorTaskFile: (input: unknown) => fileQuery(input),
  usePostOrchestratorCaseMessage: () => ({
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

function reply(patch: Partial<OrchestratorCaseMessage>) {
  return {
    id: "m1",
    conversationId: "conv-1",
    turnId: null,
    origin: OrchestratorMessageOrigin.Internal,
    kind: OrchestratorMessageKind.Reply,
    actor: "AgentFlow",
    text: "Reply text",
    createdAt: "2026-10-26T08:01:30.000Z",
    via: OrchestratorMessageVia.AgentFlow,
    ...patch,
  } satisfies OrchestratorCaseMessage;
}

function renderTimeline(message: OrchestratorCaseMessage) {
  const conversation = {
    id: "conv-1",
    status: OrchestratorConversationStatus.Idle,
    messages: [message],
    turns: [],
    decisions: [],
  } as unknown as OrchestratorCaseConversation;
  return render(
    <OrchestratorConversationTimeline
      caseId="case-1"
      conversation={conversation}
      isAdmin
      tasks={[]}
    />
  );
}

describe("OrchestratorConversationTimeline message files", () => {
  beforeEach(() => {
    fileQuery.mockReset();
    fileQuery.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    });
  });

  it("shows one chip per attachment and opens the dialog for it", async () => {
    renderTimeline(
      reply({
        attachments: [
          { taskId: "task-1", name: "a.md" },
          { taskId: "task-2", name: "b.md" },
        ],
      })
    );

    const list = screen.getByTestId("orchestrator-message-files");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await userEvent.click(within(list).getByRole("button", { name: "b.md" }));

    expect(fileQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        name: "b.md",
        taskId: "task-2",
      })
    );
  });

  it("renders no list without attachments", () => {
    renderTimeline(reply({}));

    expect(screen.queryByTestId("orchestrator-message-files")).toBeNull();
  });

  it("labels a Teams ask with the people asked", () => {
    renderTimeline(reply({ teamsAsk: { people: ["An", "Binh"] } }));

    expect(screen.getByText("Asked in Teams: An, Binh")).toBeDefined();
  });
});
