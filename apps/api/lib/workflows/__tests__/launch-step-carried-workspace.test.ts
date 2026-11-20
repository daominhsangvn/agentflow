import { LoopStepFinish } from "@agentflow-ai/loops-api/loop-step";
import { LoopCommand, LoopStatus } from "@repo/api/src/types/loop";
import { Result } from "@repo/api/src/types/result";
import { workflowPrdRuleSchema } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
} from "@repo/api/src/types/workflow-same-item";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { launchStepLoop } from "@/lib/workflows/engine/launch-step";

/** The run's carried folder reaches every loop of a carried run (agent.sameItem queue_resume). */

const mocks = vi.hoisted(() => ({
  createLoop: vi.fn(),
  listRunLoops: vi.fn(),
  loopFindMany: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      workflowRun: { findFirst: () => Promise.resolve(null) },
      loop: { findMany: mocks.loopFindMany },
    }),
}));
vi.mock("@/app/integration-tools/integration-tool-session-service", () => ({
  integrationToolSessionService: { openForStep: vi.fn() },
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: {
    findById: () =>
      Promise.resolve({
        id: "target-1",
        organizationId: "org-1",
        capabilities: { loopStepForkSession: true },
      }),
  },
}));
vi.mock("@/app/loops/service", () => ({
  loopsService: { create: mocks.createLoop },
}));
vi.mock(
  "@/app/projects/project-repository-checkouts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/app/projects/project-repository-checkouts")
    >()),
    listProjectRepositoryCheckouts: () =>
      Promise.resolve([
        {
          id: "repo-1",
          connectionId: "conn-git",
          provider: "local_git",
          externalId: "acme/api",
          fullName: "acme/api",
          name: "api",
          defaultBranch: "main",
          webUrl: "https://git.test/acme/api",
          cloneUrl: "https://git.test/acme/api.git",
          isPrimary: true,
        },
      ]),
  })
);
vi.mock("@/lib/loops/launch-harness", () => ({
  resolveLaunchHarness: () => Promise.resolve("claude"),
}));
vi.mock("@/lib/loops/loop-dispatch-utils", () => ({
  dispatchAndClassify: mocks.dispatch,
}));
vi.mock("@/lib/workflows/engine/launch", () => ({
  cancelBlockedLoop: vi.fn(),
  checkCommandSigning: () => Promise.resolve(Result.ok(null)),
  dispatchError: vi.fn(),
  mapLoopCreateError: vi.fn(),
  resolveProjectComputeTarget: vi.fn(),
}));
vi.mock("@/lib/workflows/engine/run-loops", () => ({
  listRunLoops: mocks.listRunLoops,
  recordRunLoop: () => Promise.resolve(),
}));
vi.mock("@/lib/workflows/engine/run-repository", () => ({
  recordRunRepositories: () => Promise.resolve(),
}));

const WORKSPACE = { slug: "FEA-1", fromRunId: "run-0" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createLoop.mockResolvedValue({
    loopId: "loop-new",
    status: LoopStatus.Pending,
  });
  mocks.dispatch.mockResolvedValue({ ok: true });
  mocks.listRunLoops.mockResolvedValue([
    { loopId: "attempt", command: LoopCommand.Step },
  ]);
});

const MESSAGES = [{ name: "new-messages.md", content: "The new request." }];

function attemptRow(
  attempt: WorkflowSessionCarryAttempt,
  inputs: typeof MESSAGES | null = MESSAGES
) {
  return {
    id: "attempt",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    metadata: {
      workflowRunId: "run-1",
      carriedSession: {
        fromRunId: "run-0",
        attempt,
        depth: 1,
        reason: null,
      },
      carriedWorkspace: WORKSPACE,
      step: stepConfig(inputs ?? undefined),
    },
  };
}

function stepConfig(inputs?: typeof MESSAGES) {
  return {
    runId: "run-1",
    stepId: "triage",
    name: "Triage",
    fresh: false,
    forkSession: false,
    askQuestions: false,
    artifacts: [],
    finish: LoopStepFinish.None,
    toolkit: null,
    integrationTools: false,
    ...(inputs ? { inputs } : {}),
  };
}

function launch(
  sameItem: WorkflowSameItem | undefined,
  extra: {
    forkSession?: boolean;
    workspace?: typeof WORKSPACE | null;
    inputs?: typeof MESSAGES;
  } = {}
) {
  return launchStepLoop({
    runId: "run-1",
    organizationId: "org-1",
    projectId: "project-1",
    runAsUser: { id: "user-1", clerkId: "clerk-1" },
    documentId: "issue-1",
    agent: {
      mode: WorkflowAgentMode.PlanAndExecute,
      stopOnOpenQuestions: true,
      computeTargetId: "target-1",
      runners: [],
      repository: null,
      prd: workflowPrdRuleSchema.parse({}),
      instructions: "",
      titleTemplate: "{{source.key}}",
      process: null,
      ...(sameItem ? { sameItem } : {}),
    },
    step: {
      ...stepConfig(extra.inputs),
      forkSession: extra.forkSession ?? false,
    },
    prompt: "Next.",
    computeTargetId: "target-1",
    ...(extra.workspace === undefined ? {} : { workspace: extra.workspace }),
  });
}

function createdMetadata(): Record<string, unknown> {
  return mocks.createLoop.mock.calls[0]?.[2].metadata;
}

function createdInputs(): unknown {
  const step = createdMetadata().step as { inputs?: unknown };
  return step.inputs;
}

describe("launchStepLoop carried workspace", () => {
  it("writes only the run and step without the setting, and runs no query", async () => {
    await launch(undefined);

    expect(Object.keys(createdMetadata()).sort()).toEqual([
      "step",
      "workflowRunId",
    ]);
    expect(mocks.loopFindMany).not.toHaveBeenCalled();
    expect(mocks.listRunLoops).not.toHaveBeenCalled();
  });

  it("keeps the carried folder for a later loop of a resumed run", async () => {
    mocks.loopFindMany.mockResolvedValue([
      attemptRow(WorkflowSessionCarryAttempt.Resume),
    ]);

    await launch(WorkflowSameItem.QueueResume);

    expect(createdMetadata().carriedWorkspace).toEqual(WORKSPACE);
  });

  it("keeps it for an auto-retry fork and after a forked attempt", async () => {
    mocks.loopFindMany.mockResolvedValue([
      attemptRow(WorkflowSessionCarryAttempt.Fork),
    ]);

    await launch(WorkflowSameItem.QueueResume, { forkSession: true });

    expect(createdMetadata().carriedWorkspace).toEqual(WORKSPACE);
  });

  it("has no folder when the latest attempt was fresh", async () => {
    mocks.loopFindMany.mockResolvedValue([
      attemptRow(WorkflowSessionCarryAttempt.Fresh),
    ]);

    await launch(WorkflowSameItem.QueueResume);

    expect(createdMetadata().carriedWorkspace).toBeUndefined();
  });

  it("skips the lookup for an explicit null workspace", async () => {
    await launch(WorkflowSameItem.QueueResume, { workspace: null });

    expect(mocks.loopFindMany).not.toHaveBeenCalled();
    expect(createdMetadata().carriedWorkspace).toBeUndefined();
  });

  it("writes an explicit workspace as given", async () => {
    await launch(WorkflowSameItem.QueueResume, { workspace: WORKSPACE });

    expect(mocks.loopFindMany).not.toHaveBeenCalled();
    expect(createdMetadata().carriedWorkspace).toEqual(WORKSPACE);
  });

  describe("carried input files", () => {
    it("gives a retry after a failed resume attempt the same inputs", async () => {
      mocks.loopFindMany.mockResolvedValue([
        attemptRow(WorkflowSessionCarryAttempt.Resume),
      ]);

      await launch(WorkflowSameItem.QueueResume, { forkSession: true });

      expect(createdInputs()).toEqual(MESSAGES);
    });

    it("gives a retry after a forked attempt the same inputs", async () => {
      mocks.loopFindMany.mockResolvedValue([
        attemptRow(WorkflowSessionCarryAttempt.Fork),
      ]);

      await launch(WorkflowSameItem.QueueResume);

      expect(createdInputs()).toEqual(MESSAGES);
    });

    it("keeps the inputs a launch brings", async () => {
      mocks.loopFindMany.mockResolvedValue([
        attemptRow(WorkflowSessionCarryAttempt.Resume),
      ]);
      const own = [{ name: "own.md", content: "Own." }];

      await launch(WorkflowSameItem.QueueResume, { inputs: own });

      expect(createdInputs()).toEqual(own);
    });

    it("carries none after a fresh fallback", async () => {
      mocks.loopFindMany.mockResolvedValue([
        attemptRow(WorkflowSessionCarryAttempt.Fresh),
      ]);

      await launch(WorkflowSameItem.QueueResume);

      expect(createdInputs()).toBeUndefined();
    });

    it("carries none when the attempt had none", async () => {
      mocks.loopFindMany.mockResolvedValue([
        attemptRow(WorkflowSessionCarryAttempt.Resume, null),
      ]);

      await launch(WorkflowSameItem.QueueResume);

      expect(createdInputs()).toBeUndefined();
    });

    it("carries none for a run without the setting and runs no query", async () => {
      await launch(WorkflowSameItem.Queue);
      await launch(undefined);

      for (const call of mocks.createLoop.mock.calls) {
        expect(call[2].metadata.step.inputs).toBeUndefined();
      }
      expect(mocks.loopFindMany).not.toHaveBeenCalled();
      expect(mocks.listRunLoops).not.toHaveBeenCalled();
    });

    it("carries none for a loop with an explicit workspace and runs no query", async () => {
      await launch(WorkflowSameItem.QueueResume, { workspace: null });

      expect(createdInputs()).toBeUndefined();
      expect(mocks.loopFindMany).not.toHaveBeenCalled();
    });
  });
});
