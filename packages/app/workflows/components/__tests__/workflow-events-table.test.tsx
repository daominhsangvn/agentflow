import { IntegrationDeliverySource } from "@repo/api/src/types/integration";
import {
  WorkflowEventResult,
  type WorkflowEventSummary,
} from "@repo/api/src/types/workflow-event";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, WORKFLOW_ID } from "../../__tests__/workflow-fixtures";
import { WorkflowEventHistory } from "../workflow-events-table";

const CASE_ID = "case-1";
const EVENT_ID = "event-1";

const mocks = vi.hoisted(() => ({
  events: [] as WorkflowEventSummary[],
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  payloadEventId: undefined as string | null | undefined,
}));

vi.mock("../../hooks/use-workflows", () => ({
  useWorkflowEvents: () => ({
    data: { pages: [{ events: mocks.events, nextCursor: null }] },
    isLoading: false,
    error: null,
    hasNextPage: mocks.hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mocks.fetchNextPage,
    refetch: vi.fn(),
  }),
  useWorkflowEventPayload: (_workflowId: string, eventId: string | null) => {
    mocks.payloadEventId = eventId;
    return {
      data: eventId
        ? {
            id: eventId,
            source: IntegrationDeliverySource.Webhook,
            eventType: "issue.created",
            deliveredAt: "2026-11-01T00:00:00.000Z",
            payload: { marker: "payload-body" },
          }
        : undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@repo/navigation/use-org-path", () => ({
  useOrgPath: () => (path: string) => `/acme${path}`,
}));

vi.mock("@repo/navigation/link", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function makeEvent(
  overrides: Partial<WorkflowEventSummary> = {}
): WorkflowEventSummary {
  return {
    id: EVENT_ID,
    source: IntegrationDeliverySource.Webhook,
    triggerType: "issue.created",
    sourceKey: "PROJ-1",
    result: WorkflowEventResult.Created,
    runId: RUN_ID,
    caseId: null,
    detail: null,
    occurredAt: null,
    deliveredAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [makeEvent()];
  mocks.hasNextPage = false;
  mocks.payloadEventId = undefined;
});

describe("WorkflowEventHistory", () => {
  it("shows source, event type, item and result, linking to the run", () => {
    render(<WorkflowEventHistory isAdmin={false} workflowId={WORKFLOW_ID} />);

    expect(screen.getByText("Webhook")).toBeInTheDocument();
    expect(screen.getByText("issue.created")).toBeInTheDocument();
    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run started" })).toHaveAttribute(
      "href",
      `/acme/workflows/${WORKFLOW_ID}/runs/${RUN_ID}`
    );
  });

  it("links a case message to its case", () => {
    mocks.events = [
      makeEvent({
        result: WorkflowEventResult.CaseMessage,
        runId: null,
        caseId: CASE_ID,
      }),
    ];
    render(<WorkflowEventHistory isAdmin={false} workflowId={WORKFLOW_ID} />);

    expect(screen.getByRole("link", { name: "Case message" })).toHaveAttribute(
      "href",
      `/acme/orchestrator/cases/${CASE_ID}`
    );
  });

  it("loads the next page", async () => {
    mocks.hasNextPage = true;
    render(<WorkflowEventHistory isAdmin={false} workflowId={WORKFLOW_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("hides the Payload button from members", () => {
    render(<WorkflowEventHistory isAdmin={false} workflowId={WORKFLOW_ID} />);

    expect(
      screen.queryByRole("button", { name: "Payload" })
    ).not.toBeInTheDocument();
  });

  it("opens the payload of an event for admins", async () => {
    render(<WorkflowEventHistory isAdmin workflowId={WORKFLOW_ID} />);

    await userEvent.click(screen.getByRole("button", { name: "Payload" }));
    expect(mocks.payloadEventId).toBe(EVENT_ID);
    expect(
      await screen.findByText("payload-body", { exact: false })
    ).toBeInTheDocument();
  });

  it("explains an empty history", () => {
    mocks.events = [];
    render(<WorkflowEventHistory isAdmin={false} workflowId={WORKFLOW_ID} />);

    expect(
      screen.getByText("No events yet", { exact: false })
    ).toBeInTheDocument();
  });
});
