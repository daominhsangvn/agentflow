import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openTaskPullRequests } from "@/app/orchestrator-tools/service/pull-requests";

const TASK_ID = "0199a5f0-0000-7000-8000-0000000000f9";
const TOKEN = "secret-token-value";

const mocks = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  results: [] as unknown[],
  createPullRequest: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (run: (db: unknown) => unknown) =>
    run({
      orchestratorTask: { findFirst: () => Promise.resolve(mocks.task) },
      loop: { findFirst: () => Promise.resolve({ uploadedArtifacts: null }) },
    }),
}));
vi.mock("@/lib/workflows/engine/run-loops", () => ({
  readRepoExecutionResults: () => mocks.results,
}));
vi.mock(
  "@/app/projects/project-repository-checkouts",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    listProjectRepositoryCheckouts: () =>
      Promise.resolve([
        {
          id: "r1",
          connectionId: "c1",
          provider: "local-git",
          externalId: "ext1",
          fullName: "workshop/app",
          defaultBranch: "main",
        },
      ]),
  })
);
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionRuntime: () =>
    Promise.resolve({ runtime: { secrets: { token: TOKEN } } }),
  createProviderContext: () => ({}),
}));
vi.mock("@/lib/integrations/registry", () => ({
  getIntegrationProvider: () => ({
    repositories: {
      get: mocks.get,
      createPullRequest: mocks.createPullRequest,
    },
  }),
}));

const context = { organizationId: "org", projectId: "p", caseId: "case" };
const input = {
  taskId: TASK_ID,
  title: "LD-6",
  description: "d",
  draft: false,
};
const pushed = {
  status: "pushed",
  fullName: "workshop/app",
  branchName: "LD-6",
  baseBranch: "main",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.task = { status: OrchestratorTaskStatus.Succeeded, loopId: "loop" };
  mocks.results = [pushed];
  mocks.get.mockResolvedValue({ fullName: "workshop/app" });
});

describe("openTaskPullRequests", () => {
  it("opens a pull request for a pushed branch", async () => {
    mocks.createPullRequest.mockResolvedValue({
      ok: true,
      value: {
        url: "https://git/pr/1",
        number: 1,
        externalId: "1",
        existing: false,
      },
    });
    const result = await openTaskPullRequests(context, input);
    expect(result).toMatchObject({
      ok: true,
      output: { pullRequests: [{ url: "https://git/pr/1", number: 1 }] },
    });
    expect(mocks.createPullRequest.mock.calls[0]?.[1]).toMatchObject({
      sourceBranch: "LD-6",
      targetBranch: "main",
      title: "LD-6",
    });
  });

  it("returns an existing pull request without a call", async () => {
    mocks.results = [
      {
        status: "success",
        fullName: "workshop/app",
        prUrl: "https://git/pr/2",
        prNumber: 2,
        branchName: "LD-6",
        baseBranch: "main",
        hasChanges: true,
      },
    ];
    const result = await openTaskPullRequests(context, input);
    expect(result).toMatchObject({
      ok: true,
      output: { pullRequests: [{ number: 2, existing: true }] },
    });
    expect(mocks.createPullRequest).not.toHaveBeenCalled();
  });

  it("refuses a task that is still running", async () => {
    mocks.task = { status: OrchestratorTaskStatus.Running, loopId: "loop" };
    expect(await openTaskPullRequests(context, input)).toMatchObject({
      ok: false,
    });
  });

  it("refuses when no branch was pushed", async () => {
    mocks.results = [];
    const result = await openTaskPullRequests(context, input);
    expect(JSON.stringify(result)).toContain("pushed no branch");
  });

  it("scrubs a provider failure", async () => {
    mocks.createPullRequest.mockResolvedValue({
      ok: false,
      error: `denied ${TOKEN}`,
      retryable: false,
    });
    const result = await openTaskPullRequests(context, input);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
