import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import { OrchestratorDecisionVia } from "@repo/api/src/types/orchestrator";
import { Status } from "@repo/api/src/types/result";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_ID,
  createOrchestratorDbFake,
  ORG_ID,
  type OrchestratorDbFake,
  PROJECT_CONNECTION_ID,
  PROJECT_ID,
} from "@/__tests__/support/orchestrator/orchestrator-db.test-fake";
import type { LoadedConnection } from "@/lib/integrations/connection-service";
import type { InboundEvent } from "@/lib/integrations/types";
import { decide } from "@/lib/orchestrator/decisions";
import { routeToOrchestrator } from "@/lib/orchestrator/inbound";

/** Domain spans of the orchestrator's inbound routing and decisions. */

const mocks = vi.hoisted(() => ({
  fake: null as OrchestratorDbFake | null,
  decisionDb: null as unknown,
}));

vi.mock("@repo/database", () => {
  const pick = () => mocks.decisionDb ?? mocks.fake?.db;
  const withDb = (fn: (db: unknown) => unknown) => fn(pick());
  withDb.tx = (fn: (db: unknown) => unknown) => fn(pick());
  return { withDb };
});
vi.mock("@/lib/orchestrator/advance", () => ({
  advanceConversation: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/wait-until", () => ({ waitUntil: vi.fn() }));

const WORKFLOW_ID = "0199a5f0-0000-7000-8000-0000000000f1";
const recorder = installInMemorySpans();

afterAll(() => recorder.uninstall());

beforeEach(() => {
  recorder.reset();
  mocks.decisionDb = null;
  mocks.fake = createOrchestratorDbFake();
  mocks.fake.addWorkflow(WORKFLOW_ID, "Questions on tickets");
});

function connection() {
  return {
    record: { id: CONNECTION_ID, organizationId: ORG_ID },
    provider: {},
  } as unknown as LoadedConnection;
}

function mention(): InboundEvent {
  return {
    triggerType: "jira.issue_mentioned",
    dedupKey: "LD-7:mention:comment-500",
    occurredAt: new Date("2026-10-23T08:00:00.000Z"),
    actor: { id: "u-1", displayName: "An" },
    item: {
      provider: IntegrationProviderKey.Jira,
      externalId: "10001",
      key: "LD-7",
      url: "https://acme.atlassian.net/browse/LD-7",
      title: "Half-day leave",
      container: "LD",
    },
    attributes: {},
    message: { id: "500", parentId: null, text: "@bot hello" },
  };
}

function spanNamed(name: string) {
  return recorder.spans().find((span) => span.name === name);
}

describe("orchestrator.route_inbound", () => {
  it("records a routed event per delivered target", async () => {
    const routed = await routeToOrchestrator({
      connection: connection(),
      event: mention(),
      projectConnectionId: PROJECT_CONNECTION_ID,
      workflows: [{ workflowId: WORKFLOW_ID, projectId: PROJECT_ID }],
    });

    const span = spanNamed("orchestrator.route_inbound");
    expect(span?.attributes[AfAttribute.ConnectionId]).toBe(CONNECTION_ID);
    expect(span?.events.map((event) => event.name)).toContain(
      "orchestrator.routed"
    );
    expect(span?.events[0]?.attributes?.[AfAttribute.ConversationId]).toBe(
      routed[0]?.conversationId
    );
  });

  it("marks an event without targets as ignored", async () => {
    const routed = await routeToOrchestrator({
      connection: connection(),
      event: mention(),
      projectConnectionId: PROJECT_CONNECTION_ID,
      workflows: [],
    });

    expect(routed).toEqual([]);
    expect(
      spanNamed("orchestrator.route_inbound")?.attributes[AfAttribute.Outcome]
    ).toBe(AfOutcome.Ignored);
  });
});

describe("orchestrator.decide", () => {
  it("fails the span when the decision is not pending", async () => {
    mocks.decisionDb = {
      orchestratorDecision: { findFirst: () => Promise.resolve(null) },
    };

    const result = await decide({
      organizationId: ORG_ID,
      decisionId: "decision-1",
      approved: true,
      comment: null,
      via: OrchestratorDecisionVia.Button,
      decidedBy: "An",
      decidedById: null,
    });

    expect(!result.ok && result.error).toBe(Status.NotFound);
    const span = spanNamed("orchestrator.decide");
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Error);
  });
});
