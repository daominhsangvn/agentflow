import {
  type LoopStepConfig,
  LoopStepFinish,
} from "@agentflow-ai/loops-api/loop-step";
import { LoopStatus } from "@repo/api/src/types/loop";
import { Result } from "@repo/api/src/types/result";
import {
  WorkflowRunErrorCode,
  workflowPrdRuleSchema,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Checkouts from "@/app/projects/project-repository-checkouts";
import { launchStepLoop } from "@/lib/workflows/engine/launch-step";

/** A step of a project without repositories runs on a personal Agent only. */

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  dispatch: vi.fn(),
  createLoop: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      workflowRun: { findFirst: () => Promise.resolve(null) },
      loop: { findFirst: () => Promise.resolve(null) },
    }),
}));
vi.mock("@/app/integration-tools/integration-tool-session-service", () => ({
  integrationToolSessionService: { openForStep: vi.fn() },
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { findById: mocks.findById },
}));
vi.mock("@/app/loops/service", () => ({
  loopsService: { create: mocks.createLoop },
}));
vi.mock(
  "@/app/projects/project-repository-checkouts",
  async (importOriginal) => ({
    ...(await importOriginal<typeof Checkouts>()),
    listProjectRepositoryCheckouts: () => Promise.resolve([]),
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
  recordRunLoop: () => Promise.resolve(),
}));
vi.mock("@/lib/workflows/engine/run-repository", () => ({
  recordRunRepositories: () => Promise.resolve(),
}));

const TARGET = "0199a5f0-0000-7000-8000-0000000000d1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createLoop.mockResolvedValue({
    loopId: "loop-1",
    status: LoopStatus.Pending,
  });
  mocks.dispatch.mockResolvedValue({ ok: true });
});

function targetWith(capabilities: unknown) {
  mocks.findById.mockResolvedValue({
    id: TARGET,
    organizationId: "org-1",
    machineName: "runner-old",
    capabilities,
  });
}

function launch(toolkit: LoopStepConfig["toolkit"] = null) {
  return launchStepLoop({
    runId: "run-1",
    organizationId: "org-1",
    projectId: "project-1",
    runAsUser: { id: "user-1", clerkId: "clerk-1" },
    documentId: "issue-1",
    agent: {
      mode: WorkflowAgentMode.PlanAndExecute,
      stopOnOpenQuestions: true,
      computeTargetId: TARGET,
      runners: [],
      repository: null,
      prd: workflowPrdRuleSchema.parse({}),
      instructions: "",
      titleTemplate: "{{source.key}}",
      process: null,
    },
    step: {
      runId: "run-1",
      stepId: "triage",
      name: "Triage",
      fresh: false,
      forkSession: false,
      askQuestions: false,
      artifacts: [],
      finish: LoopStepFinish.None,
      toolkit,
      integrationTools: false,
    },
    prompt: "Go.",
    computeTargetId: TARGET,
  });
}

const PERSONAL = { personalRunner: { projectKey: "PRO-1", parallel: true } };

describe("launchStepLoop without project repositories", () => {
  it("launches on a personal Agent without a repo", async () => {
    targetWith(PERSONAL);

    const result = await launch();

    expect(result.ok).toBe(true);
    expect(mocks.createLoop).toHaveBeenCalledWith(
      "org-1",
      "user-1",
      expect.objectContaining({ repo: undefined, additionalRepos: undefined })
    );
  });

  it("refuses on an automatic Agent", async () => {
    targetWith({});

    const result = await launch();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(WorkflowRunErrorCode.NoRepository);
    }
    expect(mocks.createLoop).not.toHaveBeenCalled();
  });

  it("skips the toolkit check on a personal Agent", async () => {
    targetWith(PERSONAL);

    const result = await launch({
      repository: "acme/toolkit",
    } as unknown as LoopStepConfig["toolkit"]);

    expect(result.ok).toBe(true);
    expect(mocks.createLoop).toHaveBeenCalled();
  });
});
