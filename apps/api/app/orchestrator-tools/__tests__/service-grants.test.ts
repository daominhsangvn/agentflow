import {
  OrchestratorMessageKind,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import {
  OrchestratorPageOperation,
  OrchestratorSourceOperation,
} from "@repo/api/src/types/orchestrator-grants";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";

/** The grants of agent.orchestrator.connections, checked at every tool call. */

const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";
const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  connections: {} as Record<string, string[] | "read">,
  replyOnItem: vi.fn(),
  openTaskPullRequests: vi.fn(),
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
                provider: "jira",
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
      findFirst: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
    },
    orchestratorAnchor: { create: () => Promise.resolve({}) },
  };
  return { withDb: (fn: (client: unknown) => unknown) => fn(db) };
});
vi.mock("@/lib/orchestrator/workflow-settings", async () => {
  const { workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return { loadOrchestratorWorkflows: () => workflowsWith(mocks.connections) };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: () => Promise.resolve(false),
}));
vi.mock("../service/pull-requests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service/pull-requests")>()),
  openTaskPullRequests: mocks.openTaskPullRequests,
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
        provider: { replyOnItem: mocks.replyOnItem },
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messages = [];
  mocks.connections = {};
  mocks.replyOnItem.mockResolvedValue({ ok: true, externalRef: "900" });
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

describe("orchestrator grants", () => {
  it("refuses a reply with no grant and records the refusal", async () => {
    const outcome = await call(OrchestratorToolName.Reply, { text: "Hi" });
    expect(outcome.ok).toBe(false);
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
    expect(
      mocks.messages.some((m) => m.kind === OrchestratorMessageKind.ToolRefused)
    ).toBe(true);
  });

  it("refuses attachments with comment but without attach", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    const outcome = await call(OrchestratorToolName.Reply, {
      text: "Hi",
      attachments: [{ taskId: TASK_ID, name: "a.md" }],
    });
    expect(outcome.ok).toBe(false);
    expect(mocks.replyOnItem).not.toHaveBeenCalled();
  });

  it("posts a reply with comment", async () => {
    mocks.connections = { source: [OrchestratorSourceOperation.Comment] };
    const outcome = await call(OrchestratorToolName.Reply, { text: "Hi" });
    expect(outcome.ok).toBe(true);
    expect(mocks.replyOnItem).toHaveBeenCalledTimes(1);
  });

  it("refuses pull_request_open without the grant", async () => {
    const outcome = await call(OrchestratorToolName.PullRequestOpen, {
      taskId: TASK_ID,
      title: "T",
    });
    expect(outcome.ok).toBe(false);
    expect(mocks.openTaskPullRequests).not.toHaveBeenCalled();
  });

  it("hides page_publish from describe without a publish key", async () => {
    mocks.connections = { docs: "read" };
    const described = await orchestratorToolService.describe(TOKEN);
    if (!described.ok) {
      throw new Error("unauthorized");
    }
    const names = described.value.tools.map((tool) => tool.name);
    expect(names).not.toContain(OrchestratorToolName.PagePublish);
    expect(names).toContain(OrchestratorToolName.PageGet);
    mocks.connections = { docs: [OrchestratorPageOperation.Publish] };
    const again = await orchestratorToolService.describe(TOKEN);
    if (!again.ok) {
      throw new Error("unauthorized");
    }
    expect(again.value.tools.map((tool) => tool.name)).toContain(
      OrchestratorToolName.PagePublish
    );
  });

  it("describes read-only and publish keys apart in the instructions", async () => {
    mocks.connections = {
      notes: "read",
      docs: [OrchestratorPageOperation.Publish],
    };
    const described = await orchestratorToolService.describe(TOKEN);
    if (!described.ok) {
      throw new Error("unauthorized");
    }
    const text = described.value.instructions;
    expect(text).toContain(
      `Confluence read: notes (${OrchestratorToolName.PageGet})`
    );
    expect(text).toContain("Confluence publish: docs");
    expect(text).not.toContain("Confluence publish: docs, notes");
    expect(text).not.toContain("read: docs");
  });
});
