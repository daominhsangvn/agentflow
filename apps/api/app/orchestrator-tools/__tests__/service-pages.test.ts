import { OrchestratorToolName } from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { orchestratorToolService } from "@/app/orchestrator-tools/service";
import { hashOrchestratorToken } from "@/app/orchestrator-tools/token";
import { TURN_SUPERSEDED_ERROR } from "@/lib/orchestrator/supersede";

/** The Confluence and pull request tools in the service, and page files of task_run. */

const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const TOKEN = "ost_abcdefghijklmnopqrstuvwxyz0123456789";

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  messages: [] as Row[],
  turnSuperseded: vi.fn(),
  startTask: vi.fn(),
  resolvePageInputs: vi.fn(),
  publishPage: vi.fn(),
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
    orchestratorCase: { update: () => Promise.resolve({}) },
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
  const { FULL_GRANTS, workflowsWith } = await import(
    "@/__tests__/support/orchestrator-tools/grants.test-fixtures"
  );
  return { loadOrchestratorWorkflows: () => workflowsWith(FULL_GRANTS) };
});
vi.mock("@/lib/orchestrator/supersede", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/supersede")>()),
  turnSuperseded: mocks.turnSuperseded,
}));
vi.mock("@/lib/orchestrator/case-render", () => ({
  renderCase: () => Promise.resolve("# LD-7"),
}));
vi.mock("@/lib/orchestrator/tasks", () => ({ startTask: mocks.startTask }));
vi.mock("../service/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service/pages")>()),
  resolvePageInputs: mocks.resolvePageInputs,
  publishPage: mocks.publishPage,
}));
vi.mock("../service/pull-requests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service/pull-requests")>()),
  openTaskPullRequests: mocks.openTaskPullRequests,
}));
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
  loadProjectConnectionRuntime: vi.fn(),
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
  mocks.turnSuperseded.mockResolvedValue(false);
  mocks.resolvePageInputs.mockResolvedValue({ ok: true, value: [] });
});

describe("page and pull request tools", () => {
  it("refuses page_publish and pull_request_open once a newer message arrived", async () => {
    mocks.turnSuperseded.mockResolvedValue(true);

    const publish = await orchestratorToolService.call(
      TOKEN,
      OrchestratorToolName.PagePublish,
      { file: { taskId: TASK_ID, name: "PRD.md" }, title: "PRD" }
    );
    const pr = await orchestratorToolService.call(
      TOKEN,
      OrchestratorToolName.PullRequestOpen,
      { taskId: TASK_ID, title: "Change" }
    );

    for (const result of [publish, pr]) {
      expect(result).toMatchObject({
        ok: true,
        value: { ok: false, error: TURN_SUPERSEDED_ERROR },
      });
    }
    expect(mocks.publishPage).not.toHaveBeenCalled();
    expect(mocks.openTaskPullRequests).not.toHaveBeenCalled();
  });

  it("task_run resolves page files and passes them as pageInputs", async () => {
    const page = {
      pageId: "123",
      title: "PRD",
      url: "https://x/123",
      version: 2,
      name: "PRD-LD-6.md",
      content: "# PRD",
      size: 5,
    };
    mocks.resolvePageInputs.mockResolvedValue({ ok: true, value: [page] });
    mocks.startTask.mockResolvedValue({
      ok: true,
      value: {
        taskId: TASK_ID,
        status: "running",
        runner: "runner-1",
        error: null,
        waiting: null,
      },
    });

    await orchestratorToolService.call(TOKEN, OrchestratorToolName.TaskRun, {
      runner: "runner-1",
      command: "/qa-test",
      files: [
        { taskId: TASK_ID, name: "a.md" },
        { page: "123", name: "PRD-LD-6.md" },
      ],
    });

    expect(mocks.resolvePageInputs).toHaveBeenCalledWith(expect.anything(), [
      { page: "123", name: "PRD-LD-6.md" },
    ]);
    expect(mocks.startTask).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [{ taskId: TASK_ID, name: "a.md" }],
        pageInputs: [page],
      })
    );
  });

  it("task_run refuses a bad page ref", async () => {
    mocks.resolvePageInputs.mockResolvedValue({
      ok: false,
      error: "No such page.",
    });

    const result = await orchestratorToolService.call(
      TOKEN,
      OrchestratorToolName.TaskRun,
      {
        runner: "runner-1",
        command: "/qa-test",
        files: [{ page: "nope", name: "x.md" }],
      }
    );

    expect(result.ok && result.value).toMatchObject({
      ok: false,
      error: "No such page.",
    });
    expect(mocks.startTask).not.toHaveBeenCalled();
  });
});
