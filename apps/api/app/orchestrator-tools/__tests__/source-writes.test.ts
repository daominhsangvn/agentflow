import { SourceOperation } from "@repo/api/src/types/connection-grants";
import {
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";
import { TURN_SUPERSEDED_ERROR } from "@/lib/orchestrator/supersede";

/** source_item_transition / label / link: the provider's source actions on the case's item. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  connections: {} as Record<string, string[] | "read">,
  provider: "jira",
  hasDefinition: true,
  execute: vi.fn(),
  fetchItem: vi.fn(),
  turnSuperseded: vi.fn(),
}));

vi.mock("@repo/database", () => {
  const db = {
    orchestratorTurn: {
      findFirst: () =>
        Promise.resolve({
          id: "turn-1",
          organizationId: "org-1",
          tokenHash: hashOrchestratorToken(TOKEN),
          conversation: {
            id: "conversation-1",
            projectId: "project-1",
            caseId: "case-1",
            projectConnectionId: "0199a5f0-0000-7000-8000-0000000000e1",
            case: { workflowId: "workflow-1" },
            channel: {
              item: {
                provider: mocks.provider,
                externalId: "10001",
                key: "LD-7",
                url: null,
                title: "Half-day leave",
                container: "LD",
              },
              parentId: null,
              extras: null,
            },
          },
        }),
    },
    orchestratorMessage: {
      create: (args: { data: Row }) => {
        mocks.messages.push(args.data);
        return Promise.resolve(args.data);
      },
    },
    organization: { findUnique: () => Promise.resolve({ slug: "agentflow" }) },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return { loadOrchestratorWorkflows: () => workflowsWith(mocks.connections) };
});
vi.mock("@/lib/integrations/connection-grants", () => ({
  sourceGrantDefinitions: () =>
    mocks.hasDefinition
      ? [{ configSchema: passthrough(), execute: mocks.execute }]
      : [],
}));
vi.mock("@/lib/integrations/registry", () => ({
  getIntegrationProvider: () => ({ displayName: "Microsoft Teams" }),
}));
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: mocks.turnSuperseded,
}));
vi.mock("@/lib/orchestrator/case-render", () => ({
  renderCase: () => Promise.resolve("# LD-7"),
}));
vi.mock("@/lib/orchestrator/tasks", () => ({ startTask: vi.fn() }));
vi.mock("@/lib/orchestrator/task-cancel", () => ({ cancelTask: vi.fn() }));
vi.mock("@/lib/orchestrator/decisions", () => ({
  requestDecision: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@/lib/orchestrator/waits", () => ({
  createWait: vi.fn(),
  evaluateWaits: vi.fn(),
}));
vi.mock("@/lib/integrations/project-connections", () => ({
  loadProjectConnectionRuntime: () =>
    Promise.resolve({
      connection: {
        provider: { source: { fetchItem: mocks.fetchItem } },
        runtime: { secrets: {} },
      },
    }),
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  createProviderContext: () => ({}),
}));
vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: {
    listForProject: () => Promise.resolve([]),
  },
}));

function passthrough() {
  return { safeParse: (data: unknown) => ({ success: true, data }) };
}

const ALL_WRITES = {
  source: [
    OrchestratorSourceOperation.Comment,
    OrchestratorSourceOperation.Transition,
    OrchestratorSourceOperation.Label,
    OrchestratorSourceOperation.Link,
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.connections = ALL_WRITES;
  mocks.provider = "jira";
  mocks.hasDefinition = true;
  mocks.execute.mockResolvedValue({ status: "succeeded", detail: "moved" });
  mocks.fetchItem
    .mockResolvedValueOnce({ status: "Backlog" })
    .mockResolvedValue({ status: "Planning" });
  mocks.turnSuperseded.mockResolvedValue(false);
});

async function call(tool: string, input: Record<string, unknown>) {
  const result = await orchestratorToolService.call(
    TOKEN,
    tool,
    input as never
  );
  if (!result.ok) {
    throw new Error("unauthorized");
  }
  return result.value;
}

describe("source item writes", () => {
  it("moves the item and records the status change of the turn", async () => {
    const outcome = await call(OrchestratorToolName.SourceItemTransition, {
      transitionName: "Planning",
    });
    expect(outcome).toMatchObject({
      ok: true,
      output: { done: true, from: "Backlog", to: "Planning" },
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { transitionName: "Planning", state: "Planning" },
      })
    );
    expect(mocks.messages).toEqual([
      expect.objectContaining({
        origin: OrchestratorMessageOrigin.Internal,
        kind: OrchestratorMessageKind.StatusChanged,
        turnId: "turn-1",
        payload: expect.objectContaining({ from: "Backlog", to: "Planning" }),
      }),
    ]);
  });

  it("refuses when the action is skipped", async () => {
    mocks.execute.mockResolvedValue({
      status: "skipped",
      reason: "No such transition",
    });
    const outcome = await call(OrchestratorToolName.SourceItemTransition, {
      transitionName: "Nope",
    });
    expect(outcome).toEqual({
      ok: false,
      error: "No such transition",
      retryable: false,
    });
  });

  it("refuses an item whose provider offers no such action", async () => {
    mocks.hasDefinition = false;
    const outcome = await call(OrchestratorToolName.SourceItemTransition, {
      transitionName: "Planning",
    });
    expect(outcome).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(outcome)).toContain("cannot");
  });

  it("records added and removed labels", async () => {
    await call(OrchestratorToolName.SourceItemLabel, {
      add: ["prd-ready"],
      remove: ["draft"],
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { add: ["prd-ready"], remove: ["draft"] },
      })
    );
    expect(mocks.messages).toEqual([
      expect.objectContaining({
        kind: OrchestratorMessageKind.LabelRemoved,
        turnId: "turn-1",
        payload: expect.objectContaining({
          added: ["prd-ready"],
          removed: ["draft"],
        }),
      }),
    ]);
  });

  it("records nothing for a link", async () => {
    const outcome = await call(OrchestratorToolName.SourceItemLink, {
      url: "https://wiki.example/page",
      title: "Plan",
    });
    expect(outcome.ok).toBe(true);
    expect(mocks.messages).toEqual([]);
  });

  it("refuses a superseded turn", async () => {
    mocks.turnSuperseded.mockResolvedValue(true);
    const outcome = await call(OrchestratorToolName.SourceItemLink, {
      url: "https://wiki.example/page",
      title: "Plan",
    });
    expect(outcome).toMatchObject({ ok: false, error: TURN_SUPERSEDED_ERROR });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("refuses a write that is not granted", async () => {
    mocks.connections = { source: [SourceOperation.Comment] };
    const outcome = await call(OrchestratorToolName.SourceItemTransition, {
      transitionName: "Planning",
    });
    expect(outcome.ok).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
